// ============================================================
// Discovery audit — structured coverage checker for mining phase.
//
// Maps declared sources against universal data categories and
// returns coverage scores + gap analysis. Pure: no I/O.
//
// Universal categories (vertical-agnostic):
//   Communications, Operations, Financial, People/Org,
//   Systems, External, Historical
//
// Vertical extensions can be passed in as additionalCategories.
// ============================================================

export type SourceType =
  | "email"
  | "document"
  | "api"
  | "system"
  | "interview"
  | "spreadsheet"
  | "database"
  | "chat"
  | "ticket"
  | "other";

export interface DiscoveredSource {
  name: string;
  category: string;
  type: SourceType;
}

export interface CategoryScore {
  category: string;
  sourcesFound: string[];
  coveragePct: number;
  gapPct: number;
  nextSteps: string[];
}

export interface DiscoveryAudit {
  categories: CategoryScore[];
  totalCoverage: number;
  criticalGaps: string[]; // categories < 30% coverage
  recommendations: string[];
}

// --- Category definitions ---

interface CategoryDef {
  name: string;
  keywords: string[]; // matched against source.category (lowercase)
  expectedSourceTypes: SourceType[];
  nextStepHints: string[];
}

const UNIVERSAL_CATEGORIES: CategoryDef[] = [
  {
    name: "Communications",
    keywords: [
      "communication",
      "email",
      "slack",
      "chat",
      "meeting",
      "transcript",
      "message",
      "correspondence",
      "notification",
    ],
    expectedSourceTypes: ["email", "chat", "interview"],
    nextStepHints: [
      "Check email archives (Gmail, Outlook)",
      "Export Slack/Teams channel history",
      "Review meeting transcripts or notes",
    ],
  },
  {
    name: "Operations",
    keywords: [
      "operation",
      "process",
      "runbook",
      "ticket",
      "log",
      "incident",
      "jira",
      "workflow",
      "procedure",
      "sop",
    ],
    expectedSourceTypes: ["ticket", "document", "system"],
    nextStepHints: [
      "Pull open tickets from JIRA/Linear/GitHub Issues",
      "Review runbooks or SOPs",
      "Export incident logs or post-mortems",
    ],
  },
  {
    name: "Financial",
    keywords: [
      "financial",
      "finance",
      "contract",
      "invoice",
      "budget",
      "expense",
      "revenue",
      "cost",
      "accounting",
      "payroll",
      "vendor",
      "spend",
    ],
    expectedSourceTypes: ["document", "spreadsheet", "api"],
    nextStepHints: [
      "Request vendor contracts and invoices",
      "Pull P&L or budget spreadsheets",
      "Export accounting system data (QuickBooks, Xero, NetSuite)",
    ],
  },
  {
    name: "People/Org",
    keywords: [
      "people",
      "org",
      "hr",
      "team",
      "role",
      "employee",
      "staff",
      "hiring",
      "performance",
      "org chart",
      "directory",
    ],
    expectedSourceTypes: ["document", "spreadsheet", "interview"],
    nextStepHints: [
      "Get org chart or team roster",
      "Review role descriptions and responsibilities",
      "Interview key stakeholders about ownership",
    ],
  },
  {
    name: "Systems",
    keywords: [
      "system",
      "api",
      "integration",
      "dashboard",
      "config",
      "infrastructure",
      "tool",
      "software",
      "platform",
      "database",
      "service",
    ],
    expectedSourceTypes: ["api", "system", "document"],
    nextStepHints: [
      "Document all third-party tools and integrations",
      "Review architecture diagrams or system docs",
      "Audit API connections and data flows",
    ],
  },
  {
    name: "External",
    keywords: [
      "external",
      "competitor",
      "market",
      "regulation",
      "compliance",
      "benchmark",
      "industry",
      "customer",
      "partner",
      "vendor",
    ],
    expectedSourceTypes: ["document", "interview", "other"],
    nextStepHints: [
      "Research competitor landscape",
      "Review relevant regulations or compliance requirements",
      "Gather customer or partner feedback",
    ],
  },
  {
    name: "Historical",
    keywords: [
      "historical",
      "history",
      "archive",
      "past",
      "previous",
      "legacy",
      "decision",
      "trend",
      "case study",
      "retrospective",
      "report",
    ],
    expectedSourceTypes: ["document", "database", "other"],
    nextStepHints: [
      "Pull historical reports and archives",
      "Review past decision logs or post-mortems",
      "Check for trend data or time-series records",
    ],
  },
];

// --- Scoring ---

function matchesCategory(source: DiscoveredSource, cat: CategoryDef): boolean {
  const categoryNorm = source.category.toLowerCase();
  return cat.keywords.some(
    (kw) => categoryNorm.includes(kw) || kw.includes(categoryNorm),
  );
}

function scoreCoverage(
  sources: DiscoveredSource[],
  cat: CategoryDef,
): CategoryScore {
  const matched = sources.filter((s) => matchesCategory(s, cat));
  const foundTypes = new Set(matched.map((s) => s.type));
  const expectedCount = cat.expectedSourceTypes.length;
  const foundCount = cat.expectedSourceTypes.filter((t) =>
    foundTypes.has(t),
  ).length;

  // Coverage = % of expected source types found, weighted by count
  const typeCoverage = expectedCount > 0 ? foundCount / expectedCount : 0;
  const sourceCoverage = matched.length > 0 ? Math.min(1, matched.length / 2) : 0;
  const coveragePct = Math.round(((typeCoverage + sourceCoverage) / 2) * 100);

  const nextSteps =
    coveragePct < 80
      ? cat.nextStepHints.filter((_, i) => {
          // Surface hints for missing source types
          const expectedType = cat.expectedSourceTypes[i];
          return expectedType ? !foundTypes.has(expectedType) : true;
        })
      : [];

  return {
    category: cat.name,
    sourcesFound: matched.map((s) => s.name),
    coveragePct,
    gapPct: 100 - coveragePct,
    nextSteps,
  };
}

// --- Main entry ---

export function auditDiscovery(
  sources: DiscoveredSource[],
  additionalCategories: CategoryDef[] = [],
): DiscoveryAudit {
  const allCategories = [...UNIVERSAL_CATEGORIES, ...additionalCategories];
  const categoryScores = allCategories.map((cat) =>
    scoreCoverage(sources, cat),
  );

  const totalCoverage = Math.round(
    categoryScores.reduce((sum, c) => sum + c.coveragePct, 0) /
      categoryScores.length,
  );

  const criticalGaps = categoryScores
    .filter((c) => c.coveragePct < 30)
    .map((c) => c.category);

  const recommendations: string[] = [];

  for (const score of categoryScores) {
    if (score.coveragePct === 0) {
      recommendations.push(
        `No ${score.category} sources found — this is a critical blind spot. ${score.nextSteps[0] ?? ""}`,
      );
    } else if (score.coveragePct < 30) {
      recommendations.push(
        `${score.category} coverage is weak (${score.coveragePct}%). ${score.nextSteps[0] ?? ""}`,
      );
    }
  }

  if (totalCoverage < 50) {
    recommendations.push(
      "Overall discovery coverage is below 50% — mining will produce an incomplete picture. Prioritize finding sources in critical gap categories before synthesizing.",
    );
  }

  return { categories: categoryScores, totalCoverage, criticalGaps, recommendations };
}

// Hospitality vertical extension — importable by consumers
export const HOSPITALITY_CATEGORIES: CategoryDef[] = [
  {
    name: "Pricing & Revenue",
    keywords: ["pricing", "rate", "revenue", "yield", "channel", "booking", "occupancy", "adr", "revpar"],
    expectedSourceTypes: ["spreadsheet", "api", "system"],
    nextStepHints: [
      "Export channel rate history (Expedia, Airbnb, VRBO, Booking.com)",
      "Pull ADR/RevPAR reports from PMS",
      "Review seasonal pricing strategy documents",
    ],
  },
  {
    name: "Property & Maintenance",
    keywords: ["property", "maintenance", "repair", "unit", "room", "amenity", "inspection", "work order"],
    expectedSourceTypes: ["ticket", "document", "system"],
    nextStepHints: [
      "Export work order history from property management system",
      "Review maintenance logs and inspection records",
      "Check vendor contracts for maintenance services",
    ],
  },
  {
    name: "Owner & HOA",
    keywords: ["owner", "hoa", "bylaw", "association", "board", "dues", "meeting minutes"],
    expectedSourceTypes: ["document", "email", "interview"],
    nextStepHints: [
      "Request HOA bylaws and board meeting minutes",
      "Pull owner correspondence and financial statements",
      "Interview board members about recurring issues",
    ],
  },
];
