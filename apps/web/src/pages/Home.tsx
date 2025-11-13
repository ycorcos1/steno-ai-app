import { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

const HERO_FEATURES = [
  {
    title: "Upload",
    description: "Secure S3 storage with presigned URLs for every document.",
  },
  {
    title: "Generate",
    description:
      "Compose prompts with firm templates and Bedrock to create polished drafts instantly.",
  },
  {
    title: "Collaborate",
    description:
      "Y.js powered real-time updates keep teams aligned across devices.",
  },
  {
    title: "Export",
    description:
      "One-click DOCX exports stored with lifecycle rules for cost control.",
  },
];

const createHoverHandlers = (
  base: CSSProperties,
  hover: CSSProperties
): {
  onMouseEnter: React.MouseEventHandler<HTMLButtonElement | HTMLDivElement>;
  onMouseLeave: React.MouseEventHandler<HTMLButtonElement | HTMLDivElement>;
} => ({
  onMouseEnter: (event) => {
    Object.assign(event.currentTarget.style, hover);
  },
  onMouseLeave: (event) => {
    Object.assign(event.currentTarget.style, base);
  },
});

const Home: React.FC = () => {
  const navigate = useNavigate();

  const pageStyles: CSSProperties = {
    minHeight: "100vh",
    background: "radial-gradient(circle at 15% 15%, #1e293b, #0f172a 65%)",
    color: "#e2e8f0",
    fontFamily:
      "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    display: "flex",
    flexDirection: "column",
    paddingBottom: "64px",
  };

  const heroContainer: CSSProperties = {
    maxWidth: "1040px",
    margin: "0 auto",
    padding: "96px 24px 72px",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  };

  const badgeStyles: CSSProperties = {
    alignSelf: "flex-start",
    padding: "8px 16px",
    borderRadius: "999px",
    letterSpacing: "0.18em",
    fontSize: "12px",
    fontWeight: 600,
    color: "rgba(110, 231, 183, 0.9)",
    border: "1px solid rgba(16, 185, 129, 0.35)",
    background:
      "linear-gradient(90deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))",
  };

  const headingStyles: CSSProperties = {
    fontSize: "3.5rem",
    lineHeight: 1.1,
    fontWeight: 700,
    color: "#f8fafc",
  };

  const subheadingStyles: CSSProperties = {
    maxWidth: "680px",
    fontSize: "1.2rem",
    lineHeight: 1.65,
    color: "rgba(226, 232, 240, 0.85)",
  };

  const ctaRowStyles: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: "16px",
  };

  const primaryButtonBase: CSSProperties = {
    background: "linear-gradient(135deg, #10b981, #059669)",
    color: "#052e16",
    border: "none",
    borderRadius: "999px",
    padding: "14px 32px",
    fontWeight: 600,
    fontSize: "16px",
    cursor: "pointer",
    boxShadow:
      "0 20px 32px -18px rgba(16, 185, 129, 0.6), 0 12px 20px -12px rgba(16, 185, 129, 0.4)",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
  };

  const primaryButtonHover: CSSProperties = {
    transform: "translateY(-2px)",
    boxShadow:
      "0 28px 40px -22px rgba(16, 185, 129, 0.7), 0 14px 20px -12px rgba(16, 185, 129, 0.45)",
  };

  const secondaryButtonBase: CSSProperties = {
    borderRadius: "999px",
    padding: "14px 32px",
    fontWeight: 600,
    fontSize: "16px",
    cursor: "pointer",
    border: "1px solid rgba(148, 163, 184, 0.35)",
    color: "rgba(226, 232, 240, 0.92)",
    background: "rgba(15, 23, 42, 0.5)",
    boxShadow: "0 14px 24px -18px rgba(15, 23, 42, 0.7)",
    transition:
      "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
  };

  const secondaryButtonHover: CSSProperties = {
    transform: "translateY(-2px)",
    borderColor: "rgba(148, 163, 184, 0.6)",
    boxShadow: "0 16px 28px -20px rgba(15, 23, 42, 0.75)",
  };

  const featuresSectionStyles: CSSProperties = {
    background: "rgba(15, 23, 42, 0.55)",
    borderTop: "1px solid rgba(71, 85, 105, 0.35)",
    borderBottom: "1px solid rgba(71, 85, 105, 0.25)",
    backdropFilter: "blur(12px)",
  };

  const featuresGrid: CSSProperties = {
    maxWidth: "1040px",
    margin: "0 auto",
    padding: "64px 24px",
    display: "grid",
    gap: "24px",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  };

  const featureCardBase: CSSProperties = {
    borderRadius: "18px",
    padding: "24px",
    border: "1px solid rgba(148, 163, 184, 0.22)",
    background:
      "linear-gradient(180deg, rgba(17, 24, 39, 0.9), rgba(17, 24, 39, 0.7))",
    boxShadow: "0 24px 40px -28px rgba(15, 23, 42, 0.85)",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    transition:
      "transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease",
  };

  const featureCardHover: CSSProperties = {
    transform: "translateY(-4px)",
    borderColor: "rgba(148, 163, 184, 0.4)",
    boxShadow: "0 32px 48px -30px rgba(15, 23, 42, 0.9)",
  };

  const featureTitleStyles: CSSProperties = {
    fontSize: "20px",
    fontWeight: 600,
    color: "#f8fafc",
  };

  const featureDescriptionStyles: CSSProperties = {
    fontSize: "15px",
    lineHeight: 1.6,
    color: "rgba(226, 232, 240, 0.85)",
  };

  const footerStyles: CSSProperties = {
    maxWidth: "1040px",
    margin: "0 auto",
    padding: "48px 24px 0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    color: "rgba(148, 163, 184, 0.6)",
    fontSize: "14px",
  };

  const primaryHoverHandlers = createHoverHandlers(primaryButtonBase, {
    ...primaryButtonBase,
    ...primaryButtonHover,
  });
  const secondaryHoverHandlers = createHoverHandlers(secondaryButtonBase, {
    ...secondaryButtonBase,
    ...secondaryButtonHover,
  });

  return (
    <div style={pageStyles}>
      <header style={heroContainer}>
        <span style={badgeStyles}>AI-Powered Legal Drafting</span>

        <h1 style={headingStyles}>
          Draft demand letters faster with AI-assisted templates, secure
          collaboration, and AWS-native workflows.
        </h1>

        <p style={subheadingStyles}>
          StenoAI combines Bedrock-powered generation, firm-approved templates,
          and real-time editing so your team can deliver polished documents in
          minutes instead of days.
        </p>

        <div style={ctaRowStyles}>
          <button
            type="button"
            style={primaryButtonBase}
            onClick={() => navigate("/signup")}
            {...primaryHoverHandlers}
          >
            Get Started
          </button>

          <button
            type="button"
            style={secondaryButtonBase}
            onClick={() => navigate("/login")}
            {...secondaryHoverHandlers}
          >
            Sign In
          </button>
        </div>
      </header>

      <section style={featuresSectionStyles}>
        <div style={featuresGrid}>
          {HERO_FEATURES.map((feature) => {
            const hoverHandlers = createHoverHandlers(featureCardBase, {
              ...featureCardBase,
              ...featureCardHover,
            });

            return (
              <article
                key={feature.title}
                style={featureCardBase}
                {...hoverHandlers}
              >
                <h2 style={featureTitleStyles}>{feature.title}</h2>
                <p style={featureDescriptionStyles}>{feature.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <footer style={footerStyles}>
        <span>© {new Date().getFullYear()} StenoAI</span>
        <span>Born in the cloud · Powered by AWS</span>
      </footer>
    </div>
  );
};

export default Home;
