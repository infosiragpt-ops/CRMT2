import { useId } from "react";

type OfficeFileKind = "word" | "excel" | "powerpoint" | "pdf" | "generic";

type OfficeFileIconProps = {
  name: string;
  mimeType?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
};

const sizeClasses = {
  xs: "h-5 w-5",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
  xl: "h-16 w-16",
};

const officePalettes = {
  word: {
    letter: "W",
    main: ["#4EE6FF", "#257AFF", "#0338D8"],
    band: ["#82F0FF", "#7A77FF"],
    tile: ["#2D78FF", "#022A9B"],
  },
  excel: {
    letter: "X",
    main: ["#A8F86F", "#22A446", "#0B5B25"],
    band: ["#B9FF7E", "#32C24B"],
    tile: ["#18A55C", "#086334"],
  },
  powerpoint: {
    letter: "P",
    main: ["#FFB451", "#FF5638", "#C4142D"],
    band: ["#FFB85C", "#F4483C"],
    tile: ["#E91D35", "#A50E22"],
  },
} as const;

export function officeFileKind(name: string, mimeType?: string | null): OfficeFileKind {
  const lower = `${name} ${mimeType || ""}`.toLowerCase();
  if (lower.includes("wordprocessingml") || lower.includes("msword") || /\.(docx?|dotx?)($|\?)/i.test(lower)) {
    return "word";
  }
  if (
    lower.includes("spreadsheetml") ||
    lower.includes("excel") ||
    lower.includes("text/csv") ||
    /\.(xlsx?|xlsm|csv)($|\?)/i.test(lower)
  ) {
    return "excel";
  }
  if (lower.includes("presentationml") || lower.includes("powerpoint") || /\.(pptx?|ppsx?)($|\?)/i.test(lower)) {
    return "powerpoint";
  }
  if (lower.includes("application/pdf") || /\.pdf($|\?)/i.test(lower)) {
    return "pdf";
  }
  return "generic";
}

export function officeFileExtensionLabel(name: string, mimeType?: string | null) {
  const lower = `${name} ${mimeType || ""}`.toLowerCase();
  if (lower.includes("text/csv") || /\.csv($|\?)/i.test(lower)) return "CSV";
  if (lower.includes("application/pdf") || /\.pdf($|\?)/i.test(lower)) return "PDF";
  const match = name.match(/\.([a-z0-9]{2,6})$/i);
  if (match?.[1]) return match[1].toUpperCase();
  const kind = officeFileKind(name, mimeType);
  if (kind === "word") return "DOCX";
  if (kind === "excel") return "XLSX";
  if (kind === "powerpoint") return "PPTX";
  return "DOC";
}

function OfficeSuiteIcon({
  kind,
  gradientId,
  size,
}: {
  kind: keyof typeof officePalettes;
  gradientId: string;
  size: OfficeFileIconProps["size"];
}) {
  const palette = officePalettes[kind];
  const fontSize = size === "xs" ? 25 : size === "sm" ? 27 : 29;

  return (
    <svg viewBox="0 0 64 64" className="h-full w-full drop-shadow-sm" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${gradientId}-main`} x1="12" y1="4" x2="54" y2="61" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={palette.main[0]} />
          <stop offset="52%" stopColor={palette.main[1]} />
          <stop offset="100%" stopColor={palette.main[2]} />
        </linearGradient>
        <linearGradient id={`${gradientId}-band`} x1="15" y1="12" x2="55" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={palette.band[0]} stopOpacity="0.95" />
          <stop offset="100%" stopColor={palette.band[1]} stopOpacity="0.92" />
        </linearGradient>
        <linearGradient id={`${gradientId}-tile`} x1="8" y1="27" x2="36" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={palette.tile[0]} />
          <stop offset="100%" stopColor={palette.tile[1]} />
        </linearGradient>
      </defs>
      <rect x="15" y="5" width="43" height="55" rx="11" fill={`url(#${gradientId}-main)`} />
      <path
        d="M15 16C15 9.925 19.925 5 26 5H58V20C58 26.075 53.075 31 47 31H15V16Z"
        fill={`url(#${gradientId}-band)`}
        opacity="0.9"
      />
      <path d="M15 35H58V49C58 55.075 53.075 60 47 60H15V35Z" fill="#001E99" opacity={kind === "word" ? "0.34" : "0.2"} />
      <rect x="6" y="27" width="31" height="28" rx="8" fill={`url(#${gradientId}-tile)`} />
      <text
        x="21.5"
        y="47"
        textAnchor="middle"
        fontFamily="Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        fontSize={fontSize}
        fontWeight="800"
        fill="white"
      >
        {palette.letter}
      </text>
    </svg>
  );
}

function PdfIcon({ gradientId, size }: { gradientId: string; size: OfficeFileIconProps["size"] }) {
  const fontSize = size === "xs" ? 13 : size === "sm" ? 15 : 17;
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full drop-shadow-sm" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${gradientId}-pdf`} x1="10" y1="4" x2="54" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF7668" />
          <stop offset="55%" stopColor="#E72E3D" />
          <stop offset="100%" stopColor="#A30E1B" />
        </linearGradient>
      </defs>
      <path d="M14 4H39L54 19V52C54 57.523 49.523 62 44 62H14C8.477 62 4 57.523 4 52V14C4 8.477 8.477 4 14 4Z" fill={`url(#${gradientId}-pdf)`} />
      <path d="M39 4V18C39 21.314 41.686 24 45 24H54L39 4Z" fill="#FFB3AB" opacity="0.78" />
      <text
        x="29"
        y="42"
        textAnchor="middle"
        fontFamily="Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        fontSize={fontSize}
        fontWeight="800"
        fill="white"
      >
        PDF
      </text>
    </svg>
  );
}

function GenericFileIcon({
  gradientId,
  label,
  size,
}: {
  gradientId: string;
  label: string;
  size: OfficeFileIconProps["size"];
}) {
  const fontSize = size === "xs" ? 12 : size === "sm" ? 13 : 14;
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full drop-shadow-sm" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${gradientId}-generic`} x1="10" y1="4" x2="54" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8EA2B2" />
          <stop offset="100%" stopColor="#405463" />
        </linearGradient>
      </defs>
      <path d="M14 4H39L54 19V52C54 57.523 49.523 62 44 62H14C8.477 62 4 57.523 4 52V14C4 8.477 8.477 4 14 4Z" fill={`url(#${gradientId}-generic)`} />
      <path d="M39 4V18C39 21.314 41.686 24 45 24H54L39 4Z" fill="#C9D3DA" opacity="0.72" />
      <text
        x="29"
        y="42"
        textAnchor="middle"
        fontFamily="Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        fontSize={fontSize}
        fontWeight="800"
        fill="white"
      >
        {label.slice(0, 3)}
      </text>
    </svg>
  );
}

export function OfficeFileIcon({ name, mimeType, size = "md", className = "" }: OfficeFileIconProps) {
  const rawId = useId().replace(/:/g, "");
  const kind = officeFileKind(name, mimeType);
  const label = officeFileExtensionLabel(name, mimeType);
  const classes = `${sizeClasses[size]} shrink-0 ${className}`;

  return (
    <span className={classes} aria-label={`${label} archivo`} role="img">
      {kind === "word" || kind === "excel" || kind === "powerpoint" ? (
        <OfficeSuiteIcon kind={kind} gradientId={rawId} size={size} />
      ) : kind === "pdf" ? (
        <PdfIcon gradientId={rawId} size={size} />
      ) : (
        <GenericFileIcon gradientId={rawId} label={label} size={size} />
      )}
    </span>
  );
}
