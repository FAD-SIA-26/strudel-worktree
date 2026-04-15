// Electro Chord Progression - Savour Inspired
// Genre: Electro | Key: Dm | BPM: 120 | Energy: 6/10
// Source: Savour-inspired electro arrangement

setcpm(120 / 2)

$: "<Dm A Bb Eb Dm G Dm [Bb Eb] Dm G Dm G>/2"
  .layer(
    // Reed pad
    x => chord(x).mode('above').anchor('c3').voicing()
      .s("gm_bandoneon").hpf(200).lpf(4000).gain(.25).room(.4),

    // Bass
    x => n("[0@4 0 0]/2").chord(x).anchor("e2").clip(.9)
      .mode("root").voicing().s("gm_electric_bass_finger:2")
      .lpf(300).gain(.8),

    // Guitar
    x => n("[~ 0 1 2 1 0]/2").chord(x).mode('root')
      .anchor('c4').voicing().s("gm_electric_guitar_clean:2")
      .release(.5).hpf(400).gain(.45)
  )

$: s("rd*3").gain(.3).speed(1.01).hpf(9000).room(.1)
