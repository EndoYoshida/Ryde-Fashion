import React from "react";
import { Truck, ShieldCheck, Award, Sparkles, MapPin } from "lucide-react";

export default function About() {
  const points = [
    { icon: ShieldCheck, title: "Authenticity guarantee", text: "Every item is verified genuine before it reaches you." },
    { icon: MapPin, title: "Imported from the U.S., Japan & Canada", text: "Sourced directly from trusted retailers abroad." },
    { icon: Award, title: "Trusted seller", text: "Thousands of happy customers across the Philippines." },
    { icon: Truck, title: "Fast shipping", text: "Reliable delivery, tracked from checkout to doorstep." },
  ];
  return (
    <section className="about" id="about-section">
      <div className="about-grid">
        <div className="about-visual">
          <div className="about-panel">
            <Sparkles size={30} color="#C9A15F" />
            <p>Affordable luxury,<br />thoughtfully curated</p>
          </div>
        </div>
        <div className="about-copy">
          <p className="eyebrow">Who we are</p>
          <h2>A boutique built on trust</h2>
          <p className="lede">
            Ryde began with a simple belief: that authentic luxury shouldn&rsquo;t be hard to find. We hand-select
            bags, apparel, and accessories from the United States, Japan, and Canada, and bring them home to the Philippines,
            so every customer can shop with confidence and elegance.
          </p>
          <p className="lede">
            Our mission is to make genuine, high-quality fashion accessible, one carefully verified
            piece at a time, backed by service that feels as personal as an in-store visit.
          </p>
          <div className="feature-grid">
            {points.map((p) => (
              <div className="feature-card" key={p.title}>
                <p.icon size={20} color="#C9A15F" strokeWidth={1.5} />
                <h4>{p.title}</h4>
                <p>{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
