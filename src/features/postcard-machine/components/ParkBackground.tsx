const buildings = [
  [0, 334, 61, 150], [64, 367, 45, 117], [115, 310, 62, 174], [185, 347, 51, 137],
  [245, 298, 66, 186], [322, 330, 48, 154], [383, 371, 65, 113], [456, 309, 51, 175],
  [520, 358, 58, 126], [588, 327, 43, 157], [645, 373, 65, 111], [720, 305, 58, 179],
  [790, 350, 59, 134], [860, 282, 72, 202], [941, 338, 56, 146], [1008, 371, 64, 113],
  [1082, 326, 55, 158], [1148, 349, 62, 135], [1220, 308, 55, 176], [1287, 362, 67, 122],
  [1364, 318, 76, 166],
];

function Tree({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M-10 20-5-160H7L13 20Z" fill="var(--trunk)" />
    <path d="m0-58-40-53m44 34 37-47" fill="none" stroke="var(--trunk)" strokeWidth="7" />
    <path d="M-10-222C-64-224-79-186-65-156-102-118-67-77-30-84-14-53 25-64 37-82 86-71 105-120 71-149 78-188 39-228 11-213Z" fill="var(--leaves)" />
    <path d="M-50-165Q-56-207-13-209M-67-121Q-49-143-26-132M26-195Q61-177 55-155M23-103Q48-119 72-110" stroke="var(--leaf-highlight)" strokeWidth="10" fill="none" strokeLinecap="round" opacity=".5" />
    <path d="m-4-72 6-79m0 30 20-19m-21 42-20-13" stroke="var(--trunk)" strokeWidth="3" fill="none" opacity=".45" />
  </g>;
}

export function ParkBackground() {
  return (
    <svg className="park" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="windows" width="18" height="25" patternUnits="userSpaceOnUse">
          <path d="M5 5h4v9H5Z" fill="var(--window)" opacity=".5" />
        </pattern>
        <pattern id="grass-marks" width="120" height="81" patternUnits="userSpaceOnUse">
          <path d="m21 49-2-6m3 5 4-8m59 30-3-8m5 8 3-4" stroke="var(--grass-mark)" strokeWidth="2" fill="none" />
        </pattern>
      </defs>
      <g className="day-sky">
        <circle cx="1100" cy="154" r="59" fill="#f3d38b" opacity=".23" />
        <circle className="sun" cx="1100" cy="154" r="39" fill="#efd07b" />
        <g data-cloud fill="#fff9e9" opacity=".65">
          <path d="M218 177Q211 157 231 152Q240 126 266 143Q290 139 291 160Q316 159 317 177Z" />
          <path d="M965 258Q954 238 977 234Q981 214 1008 221Q1022 213 1038 236Q1069 232 1074 258Z" />
        </g>
        <g data-cloud fill="#fff9e9" opacity=".5"><path d="M399 112Q389 94 411 90Q421 65 447 87Q472 87 475 109Z" /></g>
      </g>
      <g className="night-sky">
        <path className="moon" d="M1111 116A39 39 0 1 0 1136 181A37 37 0 0 1 1111 116" fill="#f5e5b7" />
        {Array.from({ length: 33 }, (_, i) => <circle key={i} cx={65 + (i * 137) % 1320} cy={65 + (i * 67) % 265} r={i % 3 === 0 ? 2 : 1} fill="#f8ebc9" opacity={0.4 + (i % 4) * 0.15} />)}
        <path data-shooting-star d="m930 100 60 34" stroke="#f8ebc9" strokeWidth="2" strokeLinecap="round" opacity="0" />
      </g>
      <path d="M0 422V381H92V340H150V392H219V361H285V402H369V363H423V389H495V340H554V381H655V355H729V385H828V328H907V378H1015V351H1098V382H1210V341H1280V373H1440V520H0Z" fill="var(--skyline-far)" />
      <g fill="var(--skyline)">
        {buildings.map(([x, y, width, height]) => <g key={x}>
          <rect x={x} y={y} width={width} height={height} />
          <rect x={x + 4} y={y + 6} width={width - 8} height={height - 6} fill="url(#windows)" />
          <path d={`M${x + 10} ${y}v-8h${width - 20}v8`} />
        </g>)}
        <path d="M870 282V266H881V247H890V218H894V195H898V218H902V247H912V266H923V282Z" />
        <path d="M253 298V281H265V261H277V237H281V261H294V281H306V298Z" />
      </g>
      <path d="M0 488Q163 437 338 478T713 478T1100 467T1440 481V900H0Z" fill="var(--grass)" />
      <path d="M0 587Q333 520 663 565T1440 545V900H0Z" fill="var(--grass-front)" />
      <path d="M857 497Q558 559 712 630T1030 900H1350Q1093 693 858 626T937 497Z" fill="var(--path)" />
      <path d="M0 556Q328 516 533 557M1020 570Q1242 539 1440 563" fill="none" stroke="var(--grass-mark)" strokeWidth="2" />
      <Tree x={125} y={576} scale={1.25} />
      <g className="inner-tree-left"><Tree x={327} y={533} scale={.82} /></g>
      <g className="inner-tree-right"><Tree x={1151} y={543} scale={1.02} /></g>
      <Tree x={1369} y={610} scale={1.5} />
      <Tree x={-15} y={666} scale={1.65} />
      <g transform="translate(965 569)" stroke="var(--bench-frame)" strokeWidth="5" fill="var(--bench)">
        <path d="M3 0H119V13H3ZM3 20H119V33H3ZM-4 43H126V53H-4Z" strokeWidth="2" />
        <path d="M9 53 5 77M112 53l5 24M13 43V6M108 43V6" fill="none" />
      </g>
      <path d="M0 658Q259 617 512 664L522 900H0ZM1350 683Q1418 657 1440 672V900H1408Z" fill="url(#grass-marks)" />
      <g stroke="var(--grass-mark)" fill="#eee0b2" strokeWidth="2">
        <path d="M222 754v-16m-5 8 5 4 6-10M1230 747v-20m-6 9 6 4 7-6" fill="none" />
        <circle cx="222" cy="736" r="3" /><circle cx="1230" cy="725" r="3" />
      </g>
    </svg>
  );
}
