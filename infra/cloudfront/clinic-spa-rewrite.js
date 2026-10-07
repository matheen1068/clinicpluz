// CloudFront Function, viewer-request, JavaScript runtime 2.0.
// Only clinic app routes are rewritten; the /api/* behavior must target the API origin.
function handler(event) {
  var request = event.request;
  if (request.method !== 'GET' && request.method !== 'HEAD') return request;

  var uri = request.uri;
  var match = /^\/clinic\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\/login\/?$/.exec(uri);
  if (match && match[1] !== 'admin' && match[1] !== 'api' && match[1] !== 'app' &&
      match[1] !== 'control' && match[1] !== 'controlpanel' &&
      match[1] !== 'staging' && match[1] !== 'www') {
    request.uri = '/index.html';
  }
  return request;
}
