// Boom Bap Hip-Hop Beat - Classic Pattern
// Genre: Lo-fi | BPM: 90 | Energy: 5/10
// Source: Classic boom bap drum programming

setcpm(90/4)

stack(
  s("bd ~ ~ bd ~ bd ~ ~").lpf(800).gain(0.8),
  s("~ sd ~ sd").hpf(200).gain(0.7),
  s("hh*8").gain(0.2).pan("<0.4 0.6>*4"),
  s("~ ~ ~ ~ ~ ~ oh ~").gain(0.15)
).bank("Linn9000").room(0.4)
