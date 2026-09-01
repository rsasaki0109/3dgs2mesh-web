import { writeFile } from "node:fs/promises";

const destination = process.argv[2];
if (!destination)
  throw new Error("Usage: node scripts/write-sample.mjs output.ply");
const count = 128;
const properties = [
  "x",
  "y",
  "z",
  "opacity",
  "scale_0",
  "scale_1",
  "scale_2",
  "rot_0",
  "rot_1",
  "rot_2",
  "rot_3",
  "f_dc_0",
  "f_dc_1",
  "f_dc_2",
];
const header = [
  "ply",
  "format ascii 1.0",
  `element vertex ${count}`,
  ...properties.map((name) => `property float ${name}`),
  "end_header",
];
const rows = [];
const golden = Math.PI * (3 - Math.sqrt(5));
for (let i = 0; i < count; i += 1) {
  const y = 1 - (2 * (i + 0.5)) / count;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = golden * i;
  const color = [radius * Math.cos(angle), y, radius * Math.sin(angle)];
  rows.push(
    [
      color[0],
      color[1],
      color[2],
      3.5,
      Math.log(0.22),
      Math.log(0.14),
      Math.log(0.18),
      1,
      0,
      0,
      0,
      ...color,
    ].join(" "),
  );
}
await writeFile(destination, `${header.join("\n")}\n${rows.join("\n")}\n`);
