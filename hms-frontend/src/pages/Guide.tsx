import { Link } from "react-router-dom";
import { ArrowLeft, ShoppingCart, Wallet, Boxes, BarChart3, ShieldCheck, Upload } from "lucide-react";

const STEPS = [
  {
    icon: ShoppingCart,
    title: "1. Record a sale",
    body: "Go to New Sale, add whatever the customer's buying with a quantity for each item, and submit. Stock decrements immediately, and the sale drops into the Cashier queue automatically — payment hasn't happened yet, but the item has already left the shelf.",
  },
  {
    icon: Wallet,
    title: "2. Take payment",
    body: "Go to Cashier, claim the waiting sale, add any extra charges if needed, then record payment — cash, card, or M-Pesa are all supported. The sale is marked complete once payment is in.",
  },
  {
    icon: Boxes,
    title: "3. Manage stock",
    body: "On Inventory, restock existing items, write off expired or damaged stock with a reason, or bulk-add a whole stock list at once by downloading the Excel template and uploading it back — new items are added, existing ones are left alone so nothing gets overwritten by accident.",
  },
  {
    icon: BarChart3,
    title: "4. Check your numbers",
    body: "Reports shows daily and monthly collections, outstanding insurance claims, and expenses — everything is printable or downloadable as a CSV for your own records.",
  },
  {
    icon: ShieldCheck,
    title: "5. Add your real team",
    body: "Staff lets an Admin create Order Taker and Cashier accounts. Each role only sees what it needs — an Order Taker can't take payments, and a Cashier can't add new sales — so responsibilities stay separated the way a real pharmacy counter works.",
  },
];

export default function Guide() {
  return (
    <div className="min-h-screen bg-slate-50 py-10 px-6">
      <div className="max-w-2xl mx-auto">
        <Link to="/login" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6">
          <ArrowLeft size={14} /> Back
        </Link>

        <img src="/logo.png" alt="Digital Health Solutions" className="h-9 w-auto mb-6" />
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Quick start guide</h1>
        <p className="text-slate-500 mb-8">Five steps to see how the whole system fits together — takes about five minutes.</p>

        <div className="space-y-5">
          {STEPS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-white border border-slate-200 rounded-xl p-5 flex gap-4">
              <div className="shrink-0 w-9 h-9 rounded-lg bg-dhs-50 text-dhs-700 flex items-center justify-center">
                <Icon size={18} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-800 mb-1">{title}</h2>
                <p className="text-sm text-slate-600 leading-relaxed">{body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 bg-dhs-900 rounded-xl p-6 text-center">
          <p className="text-white font-medium mb-1">Ready to try it yourself?</p>
          <p className="text-dhs-200 text-sm mb-4">Log in with the demo account and follow along, or create your own pharmacy's account.</p>
          <div className="flex items-center justify-center gap-3">
            <Link to="/login" className="bg-white text-dhs-900 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-dhs-50">
              Go to login
            </Link>
            <Link to="/signup" className="text-dhs-200 text-sm font-medium hover:text-white underline">
              Create your own account
            </Link>
          </div>
        </div>

        <p className="text-xs text-slate-400 mt-8 text-center">
          Questions or support: <a href="mailto:info@jazzmedia.co.ke" className="text-slate-600 hover:underline">info@jazzmedia.co.ke</a> / <a href="tel:+254787968586" className="text-slate-600 hover:underline">+254 787 968 586</a>
        </p>
      </div>
    </div>
  );
}
