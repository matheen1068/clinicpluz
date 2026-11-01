#!/usr/bin/env python3
"""Prepare or apply the synthetic Clinic App logo upload WAF exception.

The managed Common Rule Set's 8 KiB body rule is counted, while a replacement
rule retains that same body-size block on every route except POST profile/logo.
Other managed rules remain active on logo requests.
"""

import argparse
import hashlib
import json

import boto3

ACCOUNT = "866149839329"
DISTRIBUTION = "EP5S5732SHE3S"
WEB_ACL_NAME = "CreatedByCloudFront-38723bd6"
WEB_ACL_ID = "587c4cd1-68fd-4399-856b-6e1d4de40fbf"
WEB_ACL_ARN = (
    "arn:aws:wafv2:us-east-1:866149839329:global/webacl/"
    f"{WEB_ACL_NAME}/{WEB_ACL_ID}"
)
RULE_NAME = "ClinicPluzBlockLargeBodyExceptLogo"
TRANSFORM = [{"Priority": 0, "Type": "NONE"}]


def digest(acl):
    return hashlib.sha256(json.dumps(acl, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def changed_rules(rules):
    result = json.loads(json.dumps(rules))
    if any(rule["Name"] == RULE_NAME for rule in result):
        raise ValueError("Logo WAF rule already exists; inspect before rerunning")
    common = next((rule for rule in result if rule["Name"] == "AWS-AWSManagedRulesCommonRuleSet"), None)
    if not common or common.get("Statement", {}).get("ManagedRuleGroupStatement", {}).get("Name") != "AWSManagedRulesCommonRuleSet":
        raise ValueError("Expected Common Rule Set is absent")
    group = common["Statement"]["ManagedRuleGroupStatement"]
    overrides = group.setdefault("RuleActionOverrides", [])
    if any(item["Name"] == "SizeRestrictions_BODY" for item in overrides):
        raise ValueError("Body rule is already overridden; inspect before rerunning")
    overrides.append({"Name": "SizeRestrictions_BODY", "ActionToUse": {"Count": {}}})
    upload = {"AndStatement": {"Statements": [
        {"RegexMatchStatement": {
            "RegexString": r"^/api/workflow/clinics/[a-z0-9-]+/profile/logo$",
            "FieldToMatch": {"UriPath": {}}, "TextTransformations": TRANSFORM,
        }},
        {"ByteMatchStatement": {
            "SearchString": b"POST", "FieldToMatch": {"Method": {}},
            "TextTransformations": TRANSFORM, "PositionalConstraint": "EXACTLY",
        }},
    ]}}
    result.append({
        "Name": RULE_NAME, "Priority": max(rule["Priority"] for rule in result) + 1,
        "Statement": {"AndStatement": {"Statements": [
            {"SizeConstraintStatement": {
                "FieldToMatch": {"Body": {"OversizeHandling": "MATCH"}},
                "ComparisonOperator": "GT", "Size": 8192,
                "TextTransformations": TRANSFORM,
            }},
            {"NotStatement": {"Statement": upload}},
        ]}},
        "Action": {"Block": {}},
        "VisibilityConfig": {"SampledRequestsEnabled": True,
                             "CloudWatchMetricsEnabled": True, "MetricName": RULE_NAME},
    })
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-sha256", help="Web ACL digest printed by the plan")
    args = parser.parse_args()
    if args.apply and not args.expected_sha256:
        parser.error("--apply requires --expected-sha256 from a fresh plan")

    session = boto3.Session(region_name="us-east-1")
    if session.client("sts").get_caller_identity()["Account"] != ACCOUNT:
        raise ValueError("Wrong AWS account")
    distribution = session.client("cloudfront").get_distribution_config(Id=DISTRIBUTION)["DistributionConfig"]
    if distribution.get("WebACLId") != WEB_ACL_ARN:
        raise ValueError("Clinic App distribution has a different Web ACL")
    waf = session.client("wafv2")
    response = waf.get_web_acl(Name=WEB_ACL_NAME, Scope="CLOUDFRONT", Id=WEB_ACL_ID)
    acl = response["WebACL"]
    current_sha = digest(acl)
    if args.expected_sha256 and args.expected_sha256 != current_sha:
        raise ValueError("Web ACL changed since review; make a fresh plan")
    rules = changed_rules(acl["Rules"])
    print(json.dumps({"distribution": DISTRIBUTION, "webAclSha256": current_sha,
                      "existingRuleCount": len(acl["Rules"]), "newRuleCount": len(rules),
                      "managedBodyRule": "Count", "otherRoutesOver8KiB": "Block",
                      "logoPost": "Other WAF rules and application validation remain active"}, indent=2))
    if not args.apply:
        return

    allowed = set(waf.meta.service_model.operation_model("UpdateWebACL").input_shape.members)
    payload = {key: value for key, value in acl.items() if key in allowed}
    payload.update(Name=WEB_ACL_NAME, Scope="CLOUDFRONT", Id=WEB_ACL_ID,
                   LockToken=response["LockToken"], Rules=rules)
    waf.update_web_acl(**payload)
    print("Web ACL update submitted; allow propagation before retesting the logo upload.")


if __name__ == "__main__":
    main()
