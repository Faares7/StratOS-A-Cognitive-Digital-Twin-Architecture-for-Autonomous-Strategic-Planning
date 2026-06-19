/**
 * Mock PlanDocument for visually validating the formal-gov template.
 * Throwaway fixture — not used in production. Exercises every block type,
 * provenance kind, RTL/Arabic, and the streaming shimmer.
 */
import type {
  PlanDocument,
  ProseMirrorNode,
  Provenance,
  Block,
} from "@/types/plan-document";

// ── inline-node helpers ──────────────────────────────────────────────
const text = (t: string, mark?: "bold" | "italic"): ProseMirrorNode => ({
  type: "text",
  text: t,
  ...(mark ? { marks: [{ type: mark }] } : {}),
});
const link = (t: string, href: string): ProseMirrorNode => ({
  type: "text",
  text: t,
  marks: [{ type: "link", attrs: { href } }],
});
const para = (...inline: ProseMirrorNode[]): ProseMirrorNode => ({
  type: "doc",
  content: [{ type: "paragraph", content: inline }],
});

// ── copy (en / ar) ───────────────────────────────────────────────────
const COPY = {
  en: {
    title: "Strategic Plan",
    orgName: "Nile University · Faculty of IT & Computer Science",
    period: "2025 – 2030",
    ch1: "Executive Summary",
    introLead: "This strategic plan sets the direction of the Faculty for the 2025–2030 period. It builds on prior achievements and defines ",
    introBold: "ambitious, measurable goals",
    introTail: " for sustainable growth, innovation, and societal impact.",
    s11: "Overview",
    s11Lead: "The plan aligns institutional priorities with the ",
    s11Italic: "NAQAAE accreditation pillars",
    s11Tail: ", translating live signals from the StratOS platform into concrete commitments. ",
    s11Link: "Learn more",
    s12: "Key Highlights",
    s12Items: [
      "Digital transformation and operational excellence",
      "Stakeholder engagement and transparent governance",
      "Investment in talent development and research capacity",
      "Strategic partnerships and international collaboration",
    ],
    ch2: "Vision & Mission",
    s21: "Our Vision",
    s21Text: "To be a catalyst for positive change, driving innovation and excellence across education and research.",
    s22: "Strategic KPIs",
    kpiHeader: ["Metric", "Target", "Timeline"],
    kpiRows: [
      ["Research Output", "+15% annually", "2025–2027"],
      ["Student Satisfaction", "≥ 90%", "2025–2030"],
      ["Digital Adoption", "80% of operations", "2026–2028"],
    ],
    kpiCaption: "Table 1 — Headline performance indicators",
    figAlt: "Sample figure",
    figCaption: "Figure 1 — Illustrative growth trajectory",
    ch3: "Strategic Goals",
    s31: "Goal Areas",
    s31Items: [
      "Excellence in teaching and learning",
      "Impactful, industry-relevant research",
      "A sustainable financial and operational model",
    ],
    s32: "Implementation Roadmap",
  },
  ar: {
    title: "الخطة الاستراتيجية",
    orgName: "جامعة النيل · كلية تكنولوجيا المعلومات وعلوم الحاسب",
    period: "2025 – 2030",
    ch1: "الملخص التنفيذي",
    introLead: "تحدد هذه الخطة الاستراتيجية توجه الكلية لفترة 2025–2030، وتبني على الإنجازات السابقة وتضع ",
    introBold: "أهدافًا طموحة وقابلة للقياس",
    introTail: " من أجل نمو مستدام وابتكار وأثر مجتمعي.",
    s11: "نظرة عامة",
    s11Lead: "تربط الخطة أولويات المؤسسة بـ ",
    s11Italic: "محاور الاعتماد القومي (NAQAAE)",
    s11Tail: "، وتترجم المؤشرات الحية من منصة StratOS إلى التزامات ملموسة. ",
    s11Link: "اقرأ المزيد",
    s12: "أبرز النقاط",
    s12Items: [
      "التحول الرقمي والتميز التشغيلي",
      "إشراك أصحاب المصلحة والحوكمة الشفافة",
      "الاستثمار في تنمية المواهب وقدرات البحث",
      "الشراكات الاستراتيجية والتعاون الدولي",
    ],
    ch2: "الرؤية والرسالة",
    s21: "رؤيتنا",
    s21Text: "أن نكون محفزًا للتغيير الإيجابي، وأن نقود الابتكار والتميز في التعليم والبحث.",
    s22: "مؤشرات الأداء الاستراتيجية",
    kpiHeader: ["المؤشر", "المستهدف", "الإطار الزمني"],
    kpiRows: [
      ["الإنتاج البحثي", "+15% سنويًا", "2025–2027"],
      ["رضا الطلاب", "≥ 90%", "2025–2030"],
      ["التبني الرقمي", "80% من العمليات", "2026–2028"],
    ],
    kpiCaption: "جدول 1 — مؤشرات الأداء الرئيسية",
    figAlt: "شكل توضيحي",
    figCaption: "شكل 1 — مسار نمو توضيحي",
    ch3: "الأهداف الاستراتيجية",
    s31: "مجالات الأهداف",
    s31Items: [
      "التميز في التعليم والتعلم",
      "بحث مؤثر وذو صلة بالصناعة",
      "نموذج مالي وتشغيلي مستدام",
    ],
    s32: "خارطة طريق التنفيذ",
  },
} as const;

// ── provenance helpers ───────────────────────────────────────────────
const NOW = "2026-06-07T00:00:00.000Z";
const human = (): Provenance => ({ kind: "human", editedAt: NOW });
const agent = (
  a: "tech" | "sentiment" | "workforce" | "benchmark" | "social" | "meetings",
  source: string,
  finding: string,
  category: "strength" | "weakness" | "opportunity" | "threat",
  confidence: number,
): Provenance => ({ kind: "agent_signal", agent: a, source, finding, category, confidence });
const refPlan = (sectionHeading: string, page: number, ar: boolean): Provenance => ({
  kind: "reference_plan",
  planId: "plan-2020",
  planTitle: ar ? "الخطة الاستراتيجية 2020" : "2020 Strategic Plan",
  canonicalKey: "vision_mission",
  sectionHeading,
  page,
});

const SAMPLE_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='280'><rect width='640' height='280' fill='#1e293b'/><text x='50%' y='50%' fill='#b8922f' font-family='Georgia,serif' font-size='30' text-anchor='middle' dominant-baseline='middle'>Sample Figure</text></svg>`,
  );

export function makeSamplePlan(lang: "en" | "ar"): PlanDocument {
  const c = COPY[lang];
  const ar = lang === "ar";

  const introBlock: Block = {
    id: "b-intro",
    type: "paragraph",
    provenance: human(),
    content: para(text(c.introLead), text(c.introBold, "bold"), text(c.introTail)),
  };

  const chapters: PlanDocument["chapters"] = [
    {
      id: "ch1",
      number: 1,
      title: c.ch1,
      canonicalKey: "executive_summary",
      userAdded: false,
      intro: [introBlock],
      sections: [
        {
          id: "s1-1",
          canonicalKey: "overview",
          heading: c.s11,
          order: 0,
          status: "verified",
          generation: "complete",
          userAdded: false,
          blocks: [
            {
              id: "b1-1",
              type: "paragraph",
              provenance: refPlan(ar ? "الرؤية" : "Vision", 4, ar),
              content: para(
                text(c.s11Lead),
                text(c.s11Italic, "italic"),
                text(c.s11Tail),
                link(c.s11Link, "https://example.com"),
              ),
            },
          ],
        },
        {
          id: "s1-2",
          canonicalKey: "highlights",
          heading: c.s12,
          order: 1,
          status: "edited",
          generation: "complete",
          userAdded: false,
          blocks: [
            {
              id: "b1-2",
              type: "list",
              ordered: false,
              provenance: agent("workforce", "HR metrics", ar ? "نسبة التفرغ 41%" : "Part-time ratio at 41%", "weakness", 82),
              items: c.s12Items.map((t) => text(t)),
            },
          ],
        },
      ],
    },
    {
      id: "ch2",
      number: 2,
      title: c.ch2,
      canonicalKey: "vision_mission",
      userAdded: false,
      sections: [
        {
          id: "s2-1",
          canonicalKey: "vision",
          heading: c.s21,
          order: 0,
          status: "auto",
          generation: "complete",
          userAdded: false,
          blocks: [
            {
              id: "b2-1",
              type: "paragraph",
              provenance: refPlan(ar ? "الرؤية والرسالة" : "Vision & Mission", 6, ar),
              content: para(text(c.s21Text)),
            },
          ],
        },
        {
          id: "s2-2",
          canonicalKey: "kpis",
          heading: c.s22,
          order: 1,
          status: "auto",
          generation: "complete",
          userAdded: false,
          blocks: [
            {
              id: "b2-2t",
              type: "table",
              provenance: agent("tech", "SerpApi", ar ? "ارتفاع الطلب على مهارات الذكاء الاصطناعي" : "Surging demand for AI skills", "opportunity", 76),
              header: [...c.kpiHeader],
              rows: c.kpiRows.map((r) => r.map((cell) => text(cell))),
              caption: c.kpiCaption,
            },
            {
              id: "b2-2i",
              type: "image",
              provenance: human(),
              url: SAMPLE_IMG,
              alt: c.figAlt,
              caption: c.figCaption,
              width: "full",
            },
          ],
        },
      ],
    },
    {
      id: "ch3",
      number: 3,
      title: c.ch3,
      canonicalKey: "strategic_goals",
      userAdded: false,
      sections: [
        {
          id: "s3-1",
          canonicalKey: "goal_areas",
          heading: c.s31,
          order: 0,
          status: "auto",
          generation: "complete",
          userAdded: false,
          blocks: [
            {
              id: "b3-1",
              type: "list",
              ordered: true,
              provenance: agent("social", "Facebook", ar ? "اهتمام المجتمع بالبرامج التطبيقية" : "Community interest in applied programs", "opportunity", 71),
              items: c.s31Items.map((t) => text(t)),
            },
          ],
        },
        {
          // streaming subchapter — no blocks → renders the shimmer
          id: "s3-2",
          canonicalKey: "roadmap",
          heading: c.s32,
          order: 1,
          status: "auto",
          generation: "streaming",
          userAdded: false,
          blocks: [],
        },
      ],
    },
  ];

  return {
    id: "sample-plan",
    orgId: "sample-org",
    meta: {
      title: c.title,
      orgName: c.orgName,
      orgLogoUrl: "/logos/nu-itcs.png",
      periodLabel: c.period,
      partnerLogoUrls: ["/logos/qau.png"],
    },
    templateId: "formal-gov",
    language: lang,
    dir: ar ? "rtl" : "ltr",
    chapters,
    docStatus: "draft",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

export function makeBlankPlan(lang: "en" | "ar"): PlanDocument {
  const now = new Date().toISOString();
  const uid = Date.now().toString(36);
  return {
    id: `plan-${uid}`,
    orgId: "sample-org",
    meta: {
      title: lang === "ar" ? "مستند جديد" : "Untitled Document",
      orgName: "",
      orgLogoUrl: null,
      periodLabel: "2025 – 2030",
      partnerLogoUrls: [],
    },
    templateId: "formal-gov",
    language: lang,
    dir: lang === "ar" ? "rtl" : "ltr",
    chapters: [],
    docStatus: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

/** Walk the doc and return a block's provenance by id (for the preview's source panel). */
export function findBlockProvenance(doc: PlanDocument, blockId: string): Provenance | null {
  for (const ch of doc.chapters) {
    for (const b of ch.intro ?? []) if (b.id === blockId) return b.provenance;
    for (const s of ch.sections) for (const b of s.blocks) if (b.id === blockId) return b.provenance;
  }
  return null;
}
