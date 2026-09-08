import FeedbackForm from "@/components/FeedbackForm";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Daily Feedback</h1>
        <p className="mt-1 text-sm text-slate-500">
          Chọn giáo viên và học sinh, rồi chụp ảnh nhật ký học tập.
        </p>
      </header>
      <FeedbackForm />
    </main>
  );
}
