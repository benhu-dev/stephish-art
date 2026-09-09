import { Coin } from "./Coin";
import { Postcard } from "./Postcard";

function ArtCard({ x, y, rotate = 0 }: { x: number; y: number; rotate?: number }) {
  return <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
    <path d="M0 0 54 2 52 77 1 75Z" fill="#eee7c7" stroke="#8eaa82" />
    <path d="M5 6H47V59H5Z" fill="#a8bd85" />
    <path d="M7 58Q11 36 27 38Q43 40 47 59" fill="#e9c957" />
    <path d="M16 29Q7 7 26 9Q45 8 38 34" fill="#374d45" />
    <ellipse cx="27" cy="28" rx="11" ry="15" fill="#efd5b3" />
    <path d="M20 25H24M30 25H34M25 36Q28 38 31 35" fill="none" stroke="#624841" />
    <path d="M2 16Q15 27 6 37M44 8Q32 15 48 20" fill="none" stroke="#f1edd2" strokeWidth="3" />
    <text x="27" y="69" textAnchor="middle" fontSize="7" fill="#394c3d">hello, lovely!</text>
  </g>;
}

export function MachineIllustration() {
  return (
    <svg className="machine" viewBox="-35 0 470 700" aria-hidden="true">
      <defs>
        <linearGradient id="cardboard" x2="1" y2="1">
          <stop stopColor="#d6e7df" /><stop offset=".4" stopColor="#b6d6ce" />
          <stop offset=".55" stopColor="#dce7d6" /><stop offset="1" stopColor="#85b9b7" />
        </linearGradient>
        <linearGradient id="gold" x2="1" y2="1">
          <stop stopColor="#f5e6a2" /><stop offset=".45" stopColor="#c7b774" /><stop offset=".5" stopColor="#f4e5a5" /><stop offset="1" stopColor="#b1a36a" />
        </linearGradient>
        <pattern id="pleats" width="15" height="120" patternUnits="userSpaceOnUse">
          <path d="M0 0H15V120H0Z" fill="#faf4df" /><path d="M2 0V120M5 0V120" stroke="#cfcbbf" />
          <path d="M13 0V120" stroke="#fffdf1" strokeWidth="3" />
        </pattern>
        <pattern id="paper-grain" width="37" height="31" patternUnits="userSpaceOnUse">
          <path d="m2 5 8 1m13 17 9-2M6 27l4-3" stroke="#72563c" strokeOpacity=".12" fill="none" />
        </pattern>
        <clipPath id="coin-entry"><path d="M-35 375H97V435H-35Z" /></clipPath>
      </defs>
      <ellipse cx="219" cy="630" rx="180" ry="20" fill="#273f34" opacity=".19" />
      {/* A narrow side panel gives the fixed front view cardboard depth. */}
      <path d="m333 244 38 21 4 344-39 18Z" fill="#71adaa" stroke="#477e7a" strokeWidth="2" />
      <path d="m47 252 286-8 3 383-286-5Z" fill="url(#cardboard)" stroke="#789e91" strokeWidth="2" />
      <path d="m50 253 283-7v61L51 316Z" fill="#e282ab" />
      <path d="M52 310 103 311 108 488 52 493ZM286 294 333 293 335 489 289 484Z" fill="#eaa6c0" />
      <path d="m109 312 177-4 3 177-180 4Z" fill="#3e4c3e" />
      <path d="m109 312 13 10 2 152 165 11-180 4Z" fill="#a17a58" />
      <path d="m125 327 145-6 2 135-147 9Z" fill="#263c33" />
      <path d="M130 449Q161 421 181 446T270 435V472H129Z" fill="#3d5140" />
      <path d="m179 154 43 0 2 105-47 1Z" fill="#d35d95" stroke="#b55780" strokeWidth="2" />
      <path d="m91 64 196-5 8 119-207-4Z" fill="#c65c91" stroke="#79465f" strokeWidth="2" />
      <path d="m101 72 175-4 6 95-183 0Z" fill="url(#pleats)" stroke="#efb0ce" strokeWidth="5" />
      <path d="m99 165 183-2 13 15-207-4Z" fill="#a74b78" />
      <path d="M112 57Q100 42 120 34Q122 13 146 20Q158 2 180 15Q205 0 219 18Q243 8 250 28Q273 26 275 55Z" fill="#ede7dc" stroke="#75628b" strokeWidth="2" />
      <text x="190" y="38" textAnchor="middle" fontSize="23" fontStyle="italic" fontWeight="bold" fill="#66567c" transform="rotate(-3 190 38)">Photo</text>
      <text x="192" y="57" textAnchor="middle" fontSize="24" fontStyle="italic" fontWeight="bold" fill="#66567c">Booth</text>
      <path d="m101 185 21 56 57 28-53 27-20 68-26-57-50-26 47-36Z" fill="url(#gold)" stroke="#b8a778" />
      <path d="m102 190 3 91 70-12-49 27-21 61 0-76-72-1 46-34Z" fill="#fff9c8" opacity=".25" />
      <path d="m35 228 9 30 30 17-28 11-9 33-13-30-26-13 25-16Z" fill="url(#gold)" />
      <g transform="rotate(-7 194 282)">
        <path d="M150 260H330V307H150Z" fill="#d5ad7d" stroke="#987853" />
        <text x="163" y="277" fontSize="11" fill="#554032">100% hand-drawn, with love</text>
        <text x="167" y="295" fontSize="15" fontStyle="italic" fill="#554032">in NYC for years ♡</text>
      </g>
      <path d="M298 351C262 319 279 294 297 310 314 282 351 305 341 326Z" fill="#d74f69" stroke="#b74961" />
      <ArtCard x={67} y={61} rotate={-24} />
      <ArtCard x={297} y={358} rotate={7} />
      <ArtCard x={302} y={487} rotate={17} />
      <g transform="translate(257 118) rotate(-12)" stroke="#3b4145" strokeWidth="1.8" strokeLinejoin="round">
        <path d="M0 41 12 19Q10 3 17 4L24 21 57 0Q68-4 63 5L37 29 52 31Q61 35 54 39L43 42Q50 50 43 54L23 54 10 49Z" fill="#eee8de" />
        <path d="m22 24-7 19 14 8m-1-22 10 12 11-3M12 32l11 9" fill="none" />
        <path d="m34 21 43-23 2 4-43 26" fill="#e4bd60" />
      </g>
      <path d="M24 329Q13 315 29 308L143 300Q157 306 149 325L33 338Z" fill="#f8eedc" stroke="#a8a298" />
      <text x="33" y="325" fontSize="19" fontStyle="italic" fill="#384747" transform="rotate(-4 33 325)">@Stephish.art</text>
      <path d="m61 365 60-1 2 91-64 3Z" fill="#639c99" />
      <path d="m56 360 60-1 2 92-63 4Z" fill="#a9d8d1" stroke="#5c9290" strokeWidth="2" />
      <path d="m78 376 31-1 0 65-31 2Z" fill="url(#gold)" stroke="#b3a069" />
      <path d="M92 384H99V431H92Z" fill="#29342d" />
      <circle cx="91" cy="343" r="27" fill="#e8c64e" stroke="#b39537" strokeWidth="2" />
      <circle cx="91" cy="343" r="23" fill="none" stroke="#574a35" strokeDasharray="4 3" />
      <text x="91" y="360" textAnchor="middle" fontSize="47" fontWeight="bold" fill="#443c30">$</text>
      <path d="m65 469 34-2 1 24-34 1Z" fill="#f0eee2" />
      <text x="82" y="478" textAnchor="middle" fontSize="5" fill="#536762">HANDMADE</text>
      <text x="82" y="486" textAnchor="middle" fontSize="5" fill="#536762">WITH LOVE</text>
      <g fill="#eee8dd" stroke="#40494a" strokeWidth="1.7" strokeLinejoin="round">
        <path d="m179 524-15 16 9 31 20 26q9 5 8-5l-15-24 23 29q9 5 8-5l-20-29 26 27q9 3 6-6l-20-31-9-29Z" />
        <path d="m250 523 17 18-7 30-20 27q-8 5-8-4l14-27-22 31q-8 5-8-5l19-32-25 29q-9 3-6-6l20-32 7-29Z" />
        <path d="m174 536 12 21m70-20-11 20" fill="none" />
      </g>
      <path d="m146 492 159-1 1 27-161 4Z" fill="#388a8d" />
      <path d="m143 488 159-2 1 28-160 5Z" fill="#30a7b1" stroke="#31828a" strokeWidth="2" />
      <path d="m155 498 135-1v11l-135 3Z" fill="#303b35" />
      <path d="M51 253 333 246 337 627 50 622Z" fill="url(#paper-grain)" pointerEvents="none" />
      <path d="m58 563 51-1m151 51 66-4M339 284l24 12M58 603l43 8" stroke="#faf1db" strokeWidth="7" opacity=".3" />
      <Postcard />
      {/* This lip covers the top edge of the emerging paper. */}
      <path d="m155 497 135-1v12H155Z" fill="#283e39" />
      <Coin />
      <path d="M97 381H102V434H97Z" fill="#c5b375" />
    </svg>
  );
}
