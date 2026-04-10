/**
 * Si querés mostrar nombre completo, devolvé name tal cual.
 * Si querés algo más privado (recomendado en TV), descomentá la opción.
 */
export function maskNameOptional(name) {
  // return name; // ✅ muestra completo

  // ✅ opción privacidad: "Juan Pérez" -> "Juan P."
  const s = String(name || "").trim();
  if (!s) return "";
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1][0].toUpperCase()}.`;
}
