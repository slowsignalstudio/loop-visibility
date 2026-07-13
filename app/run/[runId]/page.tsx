import RunViewer from "@/components/RunViewer";

// Drill-down target from the fleet overview: the hop trace (Level 3) for one run.
export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return <RunViewer initialRunId={runId} />;
}
