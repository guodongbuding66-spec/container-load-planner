import type { LucideIcon, LucideProps } from "lucide-react";
import {
  AlertTriangle,
  BookMarked,
  Box,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Container,
  Copy,
  Download,
  FileSpreadsheet,
  Gauge,
  HelpCircle,
  Layers3,
  Moon,
  Play,
  Plus,
  Printer,
  QrCode,
  Ruler,
  Save,
  Scale,
  Search,
  ShieldCheck,
  Ship,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";

/**
 * Unified Lucide Icon Registry (per ui-skills Icon System guidelines).
 * Enforces consistent strokeWidth (1.75), standardized pixel sizes, and aria-hidden for decorative icons.
 */
export const ICON_REGISTRY = {
  alert: AlertTriangle,
  bookMarked: BookMarked,
  box: Box,
  boxes: Boxes,
  check: Check,
  checkCircle: CheckCircle2,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  clipboardPaste: ClipboardPaste,
  container: Container,
  copy: Copy,
  download: Download,
  fileSpreadsheet: FileSpreadsheet,
  gauge: Gauge,
  help: HelpCircle,
  layers: Layers3,
  moon: Moon,
  play: Play,
  plus: Plus,
  printer: Printer,
  qrCode: QrCode,
  ruler: Ruler,
  save: Save,
  scale: Scale,
  search: Search,
  shieldCheck: ShieldCheck,
  ship: Ship,
  sparkles: Sparkles,
  sun: Sun,
  trash: Trash2,
  upload: Upload,
  users: Users,
  close: X,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICON_REGISTRY;

const SIZE_MAP = { sm: 14, md: 16, lg: 18 } as const;

export function AppIcon({
  name,
  size = "md",
  className,
  ...rest
}: {
  name: IconName;
  size?: keyof typeof SIZE_MAP | number;
  className?: string;
} & Omit<LucideProps, "size">) {
  const Component = ICON_REGISTRY[name];
  const px = typeof size === "number" ? size : SIZE_MAP[size];
  return <Component size={px} strokeWidth={1.75} aria-hidden="true" className={className} {...rest} />;
}
