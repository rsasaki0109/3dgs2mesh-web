export function outputStem(filename: string) {
  const base = filename.split(/[\\/]/).pop() ?? "scene.ply";
  return base.replace(/\.ply$/i, "") || "scene";
}
export function outputFilename(
  filename: string,
  extension: "glb" | "ply" | "obj",
) {
  return `${outputStem(filename)}-mesh.${extension}`;
}
