import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface QuestionPayload {
  text: string;
  answerType: string;
}

interface PublishBody {
  questions: QuestionPayload[];
  title?: string;
}

type GoogleFormQuestion = Record<string, unknown>;

// ── Answer-type → Google Forms API mapping ────────────────────────────────────

function buildQuestion(answerType: string): GoogleFormQuestion {
  switch (answerType) {
    case "scale-1-5":
      return {
        required: true,
        scaleQuestion: { low: 1, high: 5, lowLabel: "Poor", highLabel: "Excellent" },
      };
    case "strongly-agree-disagree":
      return {
        required: true,
        choiceQuestion: {
          type: "RADIO",
          options: [
            { value: "Strongly Agree" },
            { value: "Agree" },
            { value: "Neutral" },
            { value: "Disagree" },
            { value: "Strongly Disagree" },
          ],
          shuffle: false,
        },
      };
    case "open-ended":
    default:
      return {
        required: false,
        textQuestion: { paragraph: true },
      };
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // Authenticate
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json(
      { error: "Not authenticated. Please sign in with Google." },
      { status: 401 }
    );
  }

  const role = session.user.role;
  if (role !== "Admin" && role !== "Editor") {
    return NextResponse.json(
      { error: "Forbidden: only Editors and Admins can publish surveys." },
      { status: 403 }
    );
  }

  const accessToken = (session as typeof session & { accessToken?: string })
    .accessToken;
  if (!accessToken) {
    return NextResponse.json(
      {
        error:
          "No Google access token found. Sign out and reconnect Google Workspace to refresh permissions.",
      },
      { status: 401 }
    );
  }

  const body: PublishBody = await request.json();
  const { questions, title = "Student Satisfaction Survey" } = body;

  if (!questions?.length) {
    return NextResponse.json({ error: "No questions provided." }, { status: 400 });
  }

  const authHeader = { Authorization: `Bearer ${accessToken}` };

  // ── Step 1: Create empty form ─────────────────────────────────────────────
  const createRes = await fetch("https://forms.googleapis.com/v1/forms", {
    method: "POST",
    headers: { ...authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ info: { title } }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    const msg: string = (err as { error?: { message?: string } })?.error?.message ?? createRes.statusText;
    if (createRes.status === 403) {
      return NextResponse.json(
        {
          error: `Google Forms API access denied: ${msg}. Enable the Google Forms API in your Cloud Console and re-authorise.`,
        },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: `Failed to create form: ${msg}` },
      { status: 502 }
    );
  }

  const form = (await createRes.json()) as { formId: string };
  const formId = form.formId;

  // ── Step 2: Add all questions in a single batchUpdate ────────────────────
  // Google Forms API rejects newlines in item titles. Bilingual questions use
  // "\n" to separate Arabic and English — collapse to " | " for the form title.
  const batchRequests = questions.map((q, i) => ({
    createItem: {
      item: {
        title: q.text.replace(/\r?\n/g, " | "),
        questionItem: { question: buildQuestion(q.answerType) },
      },
      location: { index: i },
    },
  }));

  const batchRes = await fetch(
    `https://forms.googleapis.com/v1/forms/${formId}:batchUpdate`,
    {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: batchRequests }),
    }
  );

  if (!batchRes.ok) {
    const err = await batchRes.json().catch(() => ({}));
    const msg: string = (err as { error?: { message?: string } })?.error?.message ?? batchRes.statusText;
    return NextResponse.json(
      { error: `Failed to add questions to form: ${msg}` },
      { status: 502 }
    );
  }

  return NextResponse.json({
    formUrl: `https://docs.google.com/forms/d/${formId}/viewform`,
    formId,
  });
}
