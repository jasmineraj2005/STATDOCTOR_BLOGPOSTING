const personas = [
  {
    icon: "🩺",
    title: "Locum Doctors",
    desc: "Qualified MDs and specialists seeking flexible shifts, competitive pay rates, and transparent conditions across Australia and New Zealand.",
  },
  {
    icon: "🏥",
    title: "Hospital & Clinic Administrators",
    desc: "Hiring managers and practice owners sourcing short-notice locum cover, understanding market rates, and managing compliance requirements.",
  },
  {
    icon: "🌏",
    title: "Medical Agencies & IMGs",
    desc: "International medical graduates and staffing agencies navigating AHPRA registration, visa pathways, and the Australian healthcare system.",
  },
]

export default function WhoThisIsFor() {
  return (
    <section className="who-this-is-for">
      <h2 className="who-this-is-for-heading">Who This Guide Is For</h2>
      <div className="who-cards-grid">
        {personas.map((p) => (
          <div key={p.title} className="who-card">
            <span className="who-card-icon">{p.icon}</span>
            <div>
              <h3 className="who-card-title">{p.title}</h3>
              <p className="who-card-desc">{p.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
