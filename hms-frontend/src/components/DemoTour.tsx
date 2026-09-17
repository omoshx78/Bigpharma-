import { useState, useEffect, useLayoutEffect, useCallback } from "react";
import { X } from "lucide-react";

const SEEN_KEY = "dhs_demo_tour_seen";

interface TourStep {
  navTo: string; // matches a NAV item's `to` in Layout.tsx — the tour targets that link directly, no extra markup needed on the pages themselves
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  { navTo: "/", title: "Dashboard", body: "Your at-a-glance view of today's activity — sales, low stock, and anything waiting on you." },
  { navTo: "/new-sale", title: "New Sale", body: "Start here when a customer walks in. Add items and stock decrements automatically as you go." },
  { navTo: "/cashier", title: "Cashier", body: "Sales wait here until a cashier claims them and takes payment — cash, card, or M-Pesa." },
  { navTo: "/sales", title: "Sales Lookup", body: "Search past sales by customer, sale number, or even a medicine that was sold." },
  { navTo: "/inventory", title: "Inventory", body: "See stock levels, restock, write off expired items, or bulk-import a spreadsheet of stock." },
  { navTo: "/reports", title: "Reports", body: "Daily and monthly collections, insurance claims, and expenses — printable and downloadable." },
  { navTo: "/staff", title: "Staff", body: "Add Order Taker and Cashier accounts so your real team only sees what their role needs." },
  { navTo: "/billing", title: "Billing", body: "This is where a real pharmacy pays their subscription — skipped entirely for this demo account." },
];

function useTargetRect(navTo: string | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  const recalc = useCallback(() => {
    if (!navTo) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLAnchorElement>(`a[href="${navTo}"]`);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [navTo]);

  useLayoutEffect(() => {
    recalc();
  }, [recalc]);

  useEffect(() => {
    window.addEventListener("resize", recalc);
    window.addEventListener("scroll", recalc, true);
    return () => {
      window.removeEventListener("resize", recalc);
      window.removeEventListener("scroll", recalc, true);
    };
  }, [recalc]);

  return rect;
}

export function hasSeenDemoTour(): boolean {
  return localStorage.getItem(SEEN_KEY) === "true";
}

function markTourSeen() {
  localStorage.setItem(SEEN_KEY, "true");
}

export function DemoTour({ active, onClose }: { active: boolean; onClose: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = active ? STEPS[stepIndex] : null;
  const rect = useTargetRect(step?.navTo ?? null);

  useEffect(() => {
    if (active) setStepIndex(0);
  }, [active]);

  if (!active || !step) return null;

  const finish = () => {
    markTourSeen();
    onClose();
  };

  const next = () => {
    if (stepIndex >= STEPS.length - 1) {
      finish();
    } else {
      setStepIndex((i) => i + 1);
    }
  };

  const back = () => setStepIndex((i) => Math.max(0, i - 1));

  // If the target nav item isn't in the DOM for some reason (e.g. a
  // future non-admin demo login that can't see every item), skip past
  // it rather than showing a tooltip pointing at nothing.
  if (!rect) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50" onClick={finish}>
        <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl p-5 max-w-xs shadow-xl">
          <p className="text-sm font-semibold text-slate-800 mb-1">{step.title}</p>
          <p className="text-sm text-slate-600 mb-4">{step.body}</p>
          <div className="flex items-center justify-between">
            <button onClick={finish} className="text-xs text-slate-400 hover:text-slate-600">Skip tour</button>
            <button onClick={next} className="bg-dhs-800 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-dhs-900">
              {stepIndex >= STEPS.length - 1 ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tooltipLeft = Math.min(rect.right + 16, window.innerWidth - 300);
  const tooltipTop = Math.min(Math.max(rect.top, 16), window.innerHeight - 180);

  return (
    <div className="fixed inset-0 z-[70]" onClick={finish}>
      {/* Spotlight: a box-shadow large enough to cover the viewport dims everything except this box, without needing an SVG mask */}
      <div
        className="fixed rounded-lg transition-all duration-200 pointer-events-none"
        style={{
          top: rect.top - 4,
          left: rect.left - 4,
          width: rect.width + 8,
          height: rect.height + 8,
          boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.6)",
        }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        className="fixed bg-white rounded-xl p-5 w-72 shadow-xl"
        style={{ top: tooltipTop, left: tooltipLeft }}
      >
        <button onClick={finish} className="absolute top-3 right-3 text-slate-400 hover:text-slate-600"><X size={15} /></button>
        <p className="text-xs text-slate-400 mb-1">{stepIndex + 1} of {STEPS.length}</p>
        <p className="text-sm font-semibold text-slate-800 mb-1">{step.title}</p>
        <p className="text-sm text-slate-600 mb-4">{step.body}</p>
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {stepIndex > 0 && <button onClick={back} className="text-xs text-slate-400 hover:text-slate-600">Back</button>}
            <button onClick={finish} className="text-xs text-slate-400 hover:text-slate-600">Skip tour</button>
          </div>
          <button onClick={next} className="bg-dhs-800 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-dhs-900">
            {stepIndex >= STEPS.length - 1 ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
