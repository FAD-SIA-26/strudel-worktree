export const drums = stack(
  s("bd ~ ~ [bd ~]").gain(0.9),
  s("~ cp ~ ~").gain(0.55),
  s("hh*8").gain(0.16),
  s("~ ~ oh ~").gain(0.1),
).bank("Linn9000").lpf(2400).room(0.18).slow(4 / 3)
