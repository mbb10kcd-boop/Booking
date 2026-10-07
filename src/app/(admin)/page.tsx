import { redirect } from "next/navigation";

// Programmet åbner som standard på kalenderen (Ugeplan) - Martin, oktober
// 2026. Det gamle dashboard ligger nu på /dashboard.
export default function HomePage() {
  redirect("/kalender");
}
