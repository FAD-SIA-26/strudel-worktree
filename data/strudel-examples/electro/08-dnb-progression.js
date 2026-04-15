register('rlpf', (x, pat) => { return pat.lpf(pure(x).mul(12).pow(4)) })
setGainCurve(x => Math.pow(x, 2))
setCpm(170 / 4)

$drums: stack(
  s("bd:1")
    .beat("0,7?,10", 16).duck("3:4:5"),
  s("sd:2").beat("4,12", 16),
)
  .orbit(2)._scope()

$bass: s("supersaw!8")
  .note("<c# f d# [d# a#2]>/2".sub(12)).orbit(3)
  .rlpf(slider(0.5)).lpenv("2")

$riser: s("pulse!16").dec(.1).fm(time).fmh(time).orbit(5)

$vox: s("gm_voice_oohs:0").scrub(berlin.fast(2).seg(8)
  .rib(13, 2)
)
  .delay(.6).delaytime(rand).room(1).roomsize(7).dry(0)
  .orbit(4)