#let data = json("data.json")

#set page(margin: (x: 1.6cm, y: 1.4cm))
// Typst falls back to its serif default without warning when a font is
// missing, so list every likely sans install rather than naming just one.
#set text(font: ("Helvetica", "Arial", "Liberation Sans", "DejaVu Sans"), size: 10pt)
#show heading: set text(weight: "bold")

#align(center)[
  #text(size: 17pt, weight: "bold")[#data.profile.name]
  #linebreak()
  #text(size: 9pt)[
    #data.profile.email · #data.profile.phone · #data.profile.location
    #for (_, url) in data.profile.links [ · #link(url)[#url] ]
  ]
]

#v(6pt)

#if data.summary != "" [
  == Summary
  #data.summary
  #v(4pt)
]

== Experience
#for entry in data.entries [
  *#entry.role* — #entry.org #h(1fr) #entry.start – #entry.end
  #list(..entry.bullets)
  #v(2pt)
]

== Skills
#data.skills.join(" · ")

#if data.education.len() > 0 [
  == Education
  #for e in data.education [
    *#e.degree*, #e.institution #h(1fr) #e.start – #e.end
    #if e.detail != "" [ #linebreak() #text(size: 9pt)[#e.detail] ]
    #parbreak()
  ]
]
