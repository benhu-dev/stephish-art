export function Coin() {
  return (
    <g clipPath="url(#coin-entry)">
      <g data-coin className="coin">
        <circle cx="0" cy="406" r="16" fill="#9d7331" />
        <circle cx="-3" cy="404" r="16" fill="#f3ca56" stroke="#80562a" strokeWidth="1.5" />
        <circle cx="-3" cy="404" r="12" fill="none" stroke="#9a7532" strokeDasharray="2 2" />
        <text x="-3" y="410" textAnchor="middle" fontSize="18" fill="#745326">1</text>
      </g>
    </g>
  );
}
