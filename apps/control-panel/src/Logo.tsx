/** ClinicPluz mark: an arched doorway with a medical cross. Decorative next to the wordmark. */
export default function Logo({ size = 35 }: { size?: number }) {
  return <svg className="brand-mark" width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
    <rect width="512" height="512" rx="110" fill="#123d3c" />
    <path d="M140 384V234a116 116 0 0 1 232 0V384Z" fill="#fff" />
    <path d="M172 384V234a84 84 0 0 1 168 0V384Z" fill="#5fe0c4" />
    <path d="M204 384V234a52 52 0 0 1 104 0V384Z" fill="#0e8c7a" />
    <rect x="246" y="257" width="20" height="62" rx="5" fill="#fff" />
    <rect x="225" y="278" width="62" height="20" rx="5" fill="#fff" />
  </svg>;
}
