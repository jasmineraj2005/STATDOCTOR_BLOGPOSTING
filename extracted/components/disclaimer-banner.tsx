export default function DisclaimerBanner() {
  return (
    <div className="disclaimer-banner">
      <span style={{ fontSize: "1rem", flexShrink: 0 }}>⚠️</span>
      <p style={{ margin: 0 }}>
        <strong>Medical Disclaimer:</strong> This article is for general informational purposes only and does not
        constitute medical or legal advice. AHPRA registration requirements, Medicare billing rules, and
        industrial award rates change regularly — always verify with{" "}
        <a href="https://www.ahpra.gov.au" target="_blank" rel="noopener noreferrer">
          AHPRA
        </a>
        ,{" "}
        <a href="https://www.servicesaustralia.gov.au/medicare" target="_blank" rel="noopener noreferrer">
          Services Australia
        </a>
        , and your medical indemnity insurer before acting on any information here.
      </p>
    </div>
  )
}
