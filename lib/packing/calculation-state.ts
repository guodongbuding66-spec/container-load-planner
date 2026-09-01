export function isObsoleteCalculation(activeRevision: number | null, inputRevision: number) {
  return activeRevision !== null && activeRevision !== inputRevision;
}
