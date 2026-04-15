setCps(150 / 60 / 4)

samples('github:algorave-dave/samples')
samples('github:tidalcycles/dirt-samples')

const Structures = [
  "{x ~!6 x ~ ~ x ~!3 x ~}%16",
  "{x*4}",
  "{~}",
]

const PG = [
  "{0.3 0.8!6 0.3 0.8!2 0.3! 0.3 1}",
  "{0.3 0.8}%8",
  "{0.8}",
]

const beat = 1

DRUMS: stack(
  s("tech:5").postgain(5).pcurve(2).pdec(1).struct(pick(Structures, beat)),
  s("[~ cp]").speed(1).fast(2).postgain(0.15).lpf(3000),
  s("breaks165").gain(0.4).loopAt(1).chop(16).fit().postgain(pick(PG, beat)),
)

BASSLINE: note("f#3@8 c#3@3 d3@5 a3@8 c#3@3 d3@5 f#2@8 c#3@3 d3@5 d2@8 d3@3 c#3@5").slow(8)
  .struct("x*16")
  .sustain("0.5")
  .sound("[square, sawtooth]")
  .transpose("[-12, 0]")
  .coarse(2)
  .decay(0.075).gain(0.75)
  .hpf(150)
  .lpf(slider(350, 350, 2000))
  .postgain(pick(PG, beat))
  ._punchcard({ width: 600 })

VOXCHOP1: s("gm_voice_oohs".slow(2))
  .note("g#1")
  .slice(8, "<5 6>".fast(2))
  .chop(32).cut(1).loopAt(4)
  .gain("<0.5 1.6>".slow(2))
  .lpf(slider(3755.2, 600, 4000))
  .postgain(pick(PG, beat))
  ._scope({ width: 680 })