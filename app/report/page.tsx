import { Suspense } from "react";

import { SharedReportPage } from "@/components/shared-report-page";

export default function ReportPage() {
  return (
    <Suspense fallback={null}>
      <SharedReportPage />
    </Suspense>
  );
}
