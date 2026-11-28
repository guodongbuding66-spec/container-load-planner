/**
 * Direction 06: Industrial CAD Engineering File Parsers (STEP ISO-10303-21, IGES)
 * & 3ds Max MAXScript Direct Bridge Exporter.
 */
export interface CadEnvelopeResult {
  format: "STEP" | "IGES";
  unitDetected: "mm" | "m" | "inch";
  pointCount: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  boundingVolumeM3: number;
  centerOfGravityMm: { x: number; y: number; z: number };
  supportableFlatFaces: Array<"bottom" | "top" | "left" | "right" | "front" | "back">;
  notesZh: string;
  notesEn: string;
}

function finalizeEnvelope(
  format: "STEP" | "IGES",
  pts: Array<[number, number, number]>,
  unit: "mm" | "m" | "inch",
): CadEnvelopeResult | null {
  if (pts.length < 2) return null;
  const scale = unit === "m" ? 1000 : unit === "inch" ? 25.4 : 1;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let sumX = 0, sumY = 0, sumZ = 0;

  for (const [rx, ry, rz] of pts) {
    const x = rx * scale;
    const y = ry * scale;
    const z = rz * scale;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
    sumX += x;
    sumY += y;
    sumZ += z;
  }

  const lengthMm = Math.max(1, Math.round(maxX - minX));
  const widthMm = Math.max(1, Math.round(maxY - minY));
  const heightMm = Math.max(1, Math.round(maxZ - minZ));

  // Detect flat faces where >= 3 vertices share the extreme plane within 1mm tolerance
  const tol = 1.0;
  let botC = 0, topC = 0, leftC = 0, rightC = 0, frontC = 0, backC = 0;
  for (const [rx, ry, rz] of pts) {
    const x = rx * scale, y = ry * scale, z = rz * scale;
    if (Math.abs(z - minZ) <= tol) botC++;
    if (Math.abs(z - maxZ) <= tol) topC++;
    if (Math.abs(y - minY) <= tol) leftC++;
    if (Math.abs(y - maxY) <= tol) rightC++;
    if (Math.abs(x - minX) <= tol) frontC++;
    if (Math.abs(x - maxX) <= tol) backC++;
  }
  const faces: CadEnvelopeResult["supportableFlatFaces"] = [];
  if (botC >= 3) faces.push("bottom");
  if (topC >= 3) faces.push("top");
  if (leftC >= 3) faces.push("left");
  if (rightC >= 3) faces.push("right");
  if (frontC >= 3) faces.push("front");
  if (backC >= 3) faces.push("back");

  return {
    format,
    unitDetected: unit,
    pointCount: pts.length,
    lengthMm,
    widthMm,
    heightMm,
    boundingVolumeM3: Number(((lengthMm * widthMm * heightMm) / 1e9).toFixed(4)),
    centerOfGravityMm: {
      x: Math.round(sumX / pts.length - minX),
      y: Math.round(sumY / pts.length - minY),
      z: Math.round(sumZ / pts.length - minZ),
    },
    supportableFlatFaces: faces,
    notesZh: `已从 ${format} 工程文件提取 ${pts.length} 个空间顶点（自动识别单位：${unit}），包络尺寸 ${lengthMm}×${widthMm}×${heightMm} mm，识别可承托平面 ${faces.length} 个。`,
    notesEn: `Extracted ${pts.length} 3D vertices from ${format} (unit: ${unit}); envelope ${lengthMm}×${widthMm}×${heightMm} mm with ${faces.length} flat support faces.`,
  };
}

/**
 * Parses ISO-10303-21 STEP (.stp/.step) ASCII files by extracting CARTESIAN_POINT entities
 * and detecting SI_UNIT / CONVERSION_BASED_UNIT.
 */
export function parseStepCadEnvelope(stepText: string): CadEnvelopeResult | null {
  const upper = stepText.toUpperCase();
  const unit: "mm" | "m" | "inch" = upper.includes("'INCH'") || upper.includes("INCHES")
    ? "inch"
    : upper.includes("SI_UNIT($,.METRE.)")
      ? "m"
      : "mm";

  const pts: Array<[number, number, number]> = [];
  const regex = /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*,\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*,\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*\)\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stepText)) !== null) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const z = Number(match[3]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      pts.push([x, y, z]);
    }
  }
  return finalizeEnvelope("STEP", pts, unit);
}

/**
 * Parses IGES (.igs/.iges) Parameter Data section for Entity 116 (Point) and Entity 110 (Line).
 */
export function parseIgesCadEnvelope(igesText: string): CadEnvelopeResult | null {
  const lines = igesText.split(/\r?\n/);
  const globalText = lines.filter((l) => l.length >= 73 && l[72] === "G").map((l) => l.slice(0, 72)).join("");
  const unit: "mm" | "m" | "inch" = globalText.includes("2HMM") ? "mm" : globalText.includes("2HIN") ? "inch" : globalText.includes("1HM") ? "m" : "mm";

  const paramRecords = lines
    .filter((l) => l.length >= 73 && l[72] === "P")
    .map((l) => l.slice(0, 64).trim())
    .join(" ")
    .split(";");

  const pts: Array<[number, number, number]> = [];
  for (const rec of paramRecords) {
    const fields = rec.split(",").map((s) => s.trim()).filter(Boolean);
    if (!fields.length) continue;
    const entityType = fields[0];
    if (entityType === "116" && fields.length >= 4) {
      const x = Number(fields[1]), y = Number(fields[2]), z = Number(fields[3]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) pts.push([x, y, z]);
    } else if (entityType === "110" && fields.length >= 7) {
      const nums = fields.slice(1, 7).map(Number);
      if (nums.every(Number.isFinite)) {
        pts.push([nums[0], nums[1], nums[2]]);
        pts.push([nums[3], nums[4], nums[5]]);
      }
    }
  }
  return finalizeEnvelope("IGES", pts, unit);
}

/**
 * Generates a ready-to-run 3ds Max MAXScript bridge (.ms) that exports selected objects'
 * exact mm bounding dimensions, SKU name, weight user-property, and CargoFit JSON payload.
 */
export function generate3dsMaxCargoFitBridgeScript(): string {
  return `-- CargoFit 3ds Max Bridge Exporter (MAXScript v2.2.0)
-- Select one or more product/carton nodes in 3ds Max and run this script to export CargoFit JSON.
(
    local sel = selection as array
    if sel.count == 0 then (
        messageBox "Please select at least one 3D product/carton object in 3ds Max." title:"CargoFit Bridge"
    ) else (
        local outPath = getSaveFileName caption:"Export CargoFit SKU JSON" types:"JSON (*.json)|*.json|"
        if outPath != undefined then (
            local unitScaleToMm = case units.SystemType of (
                #millimeters: 1.0
                #centimeters: 10.0
                #meters: 1000.0
                #inches: 25.4
                #feet: 304.8
                default: 1.0
            )
            local f = createFile outPath
            format "{\\n  \\"source\\": \\"3dsmax-bridge-v2.2\\",\\n  \\"products\\": [\\n" to:f
            for i = 1 to sel.count do (
                local obj = sel[i]
                local bb = nodeGetBoundingBox obj (matrix3 1)
                local dims = (bb[2] - bb[1]) * unitScaleToMm
                local wProp = getUserProp obj "cargofit_weight_kg"
                local qProp = getUserProp obj "cargofit_qty"
                local wt = if wProp != undefined then (wProp as float) else 15.0
                local qty = if qProp != undefined then (qProp as integer) else 1
                local comma = if i < sel.count then "," else ""
                format "    {\\"sku\\": \\"%\\", \\"name\\": \\"%\\", \\"length\\": %, \\"width\\": %, \\"height\\": %, \\"weight\\": %, \\"quantity\\": %}%\\n" obj.name obj.name (dims.x as integer) (dims.y as integer) (dims.z as integer) wt qty comma to:f
            )
            format "  ]\\n}\\n" to:f
            close f
            messageBox ("Exported " + (sel.count as string) + " SKU(s) to CargoFit JSON: " + outPath) title:"CargoFit Bridge"
        )
    )
)
`;
}
