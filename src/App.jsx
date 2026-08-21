import { lazy, Suspense } from 'react'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import RoleRoute from '@/components/RoleRoute';
import AppErrorBoundary from '@/components/AppErrorBoundary';
import ProtectedRoute from '@/components/ProtectedRoute';
import GuestRoute from '@/components/GuestRoute';
import { POLICIES } from '@/lib/policyRegistry';

// Route-level code splitting keeps the public homepage fast instead of parsing
// every customer/admin/ops screen during initial load.
const PageNotFound = lazy(() => import('./lib/PageNotFound'));
const Login = lazy(() => import('@/pages/Login'));
const Register = lazy(() => import('@/pages/Register'));
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const OAuthConsent = lazy(() => import('@/pages/OAuthConsent'));
const AdminLogin = lazy(() => import('@/pages/admin/AdminLogin'));
const AdminHub = lazy(() => import('@/pages/admin/AdminHub'));
const WorldzShell = lazy(() => import('@/components/visa/WorldzShell'));
const CustomerShell = lazy(() => import('@/components/visa/CustomerShell'));
const UnifiedWizard = lazy(() => import('@/pages/wizard/UnifiedWizard'));
const Destinations = lazy(() => import('@/pages/visa/Destinations'));
const VisaHomepage = lazy(() => import('@/pages/visa/VisaHomepage'));
const About = lazy(() => import('@/pages/About'));
const Contact = lazy(() => import('@/pages/Contact'));
const DestinationPage = lazy(() => import('@/pages/visa/DestinationPage'));
const SearchResultsPage = lazy(() => import('@/pages/visa/SearchResultsPage'));
const SavedDestinations = lazy(() => import('@/pages/visa/SavedDestinations'));
const DestinationContentAdmin = lazy(() => import('@/pages/visa/DestinationContentAdmin'));
const VisaProviders = lazy(() => import('@/pages/visa/VisaProviders'));
const CountryCapabilityAdmin = lazy(() => import('@/pages/visa/CountryCapabilityAdmin'));
const VisaDashboard = lazy(() => import('@/pages/visa/VisaDashboard'));
const ApplicationWizard = lazy(() => import('@/pages/visa/ApplicationWizard'));
const ApplicationWorkspace = lazy(() => import('@/pages/visa/ApplicationWorkspace'));
const VisaDocuments = lazy(() => import('@/pages/visa/Documents'));
const DocumentDetail = lazy(() => import('@/pages/visa/DocumentDetail'));
const GovernmentForm = lazy(() => import('@/pages/visa/GovernmentForm'));
const GovernmentFormsAdmin = lazy(() => import('@/pages/visa/GovernmentFormsAdmin'));
const SubmissionProviders = lazy(() => import('@/pages/visa/SubmissionProviders'));
const AppointmentsOps = lazy(() => import('@/pages/visa/AppointmentsOps'));
const Notifications = lazy(() => import('@/pages/visa/Notifications'));
const NotificationPreferences = lazy(() => import('@/pages/visa/NotificationPreferences'));
const SupportCenter = lazy(() => import('@/pages/visa/SupportCenter'));
const SupportAdmin = lazy(() => import('@/pages/visa/SupportAdmin'));
const ReviewsAdmin = lazy(() => import('@/pages/visa/ReviewsAdmin'));
const DestinationDetail = lazy(() => import('@/pages/visa/DestinationDetail'));
const VisaIntelligenceAdmin = lazy(() => import('@/pages/visa/VisaIntelligenceAdmin'));
const FinalReview = lazy(() => import('@/pages/visa/FinalReview'));
const OrderConfirmation = lazy(() => import('@/pages/visa/OrderConfirmation'));
const AdminFinance = lazy(() => import('@/pages/visa/AdminFinance'));
const OperationsDashboard = lazy(() => import('@/pages/visa/OperationsDashboard'));
const OperationsCase = lazy(() => import('@/pages/visa/OperationsCase'));
const ApplicationStatus = lazy(() => import('@/pages/visa/ApplicationStatus'));
const AccountDashboard = lazy(() => import('@/pages/visa/AccountDashboard'));
const Travelers = lazy(() => import('@/pages/visa/Travelers'));
const Trips = lazy(() => import('@/pages/visa/Trips'));
const AccountSettingsPage = lazy(() => import('@/pages/visa/AccountSettings'));
const Profile = lazy(() => import('@/pages/visa/Profile'));
const VisaWizard = lazy(() => import('@/pages/wizard/VisaWizard'));
const CaseDetail = lazy(() => import('@/pages/wizard/CaseDetail'));
const AdminCases = lazy(() => import('@/pages/admin/AdminCases'));
const AdminCaseDetail = lazy(() => import('@/pages/admin/AdminCaseDetail'));
const QACommandCenter = lazy(() => import('@/pages/admin/QACommandCenter'));
const SystemFlowQA = lazy(() => import('@/pages/admin/SystemFlowQA'));
const TrustCompliance = lazy(() => import('@/pages/admin/TrustCompliance'));
const HelpContentAdmin = lazy(() => import('@/pages/visa/HelpContentAdmin'));
const HelpArticleDetail = lazy(() => import('@/pages/visa/HelpArticleDetail'));
const AdminRefunds = lazy(() => import('@/pages/admin/AdminRefunds'));
const ContentAudit = lazy(() => import('@/pages/admin/ContentAudit'));
const OperationsTaskQueue = lazy(() => import('@/pages/visa/OperationsTaskQueue'));
const OperationsTaskDetail = lazy(() => import('@/pages/visa/OperationsTaskDetail'));
const OperationsCommandCenter = lazy(() => import('@/pages/admin/OperationsCommandCenter'));
const LaunchControlTower = lazy(() => import('@/pages/admin/LaunchControlTower'));
const PullRequestsAdmin = lazy(() => import('@/pages/admin/PullRequestsAdmin'));
const TravelTools = lazy(() => import('@/pages/visa/TravelTools'));
const HelpCenter = lazy(() => import('@/pages/visa/HelpCenter'));
const LegalLayout = lazy(() => import('@/pages/legal/LegalLayout'));
const LegalDirectory = lazy(() => import('@/pages/legal/LegalDirectory'));
const TrustCenter = lazy(() => import('@/pages/legal/TrustCenter'));
const PolicyView = lazy(() => import('@/pages/legal/PolicyView'));

function LegacyApplicationRedirect() {
  const { id } = useParams();
  return <Navigate to={`/cases/${id}`} replace />;
}

const AUTH_ROUTES = new Set(['/login', '/register', '/forgot-password', '/reset-password']);

const AuthenticatedApp = () => {
  const { authError } = useAuth();
  const location = useLocation();
  const isAuthRoute = AUTH_ROUTES.has(location.pathname);

  // Public pages (homepage, destinations, about) must render regardless of the
  // auth/public-settings probe outcome. The probe has historically failed or
  // hung in the preview environment; a non-auth error there must never blank the
  // homepage. Only a genuine "user not registered" denial intercepts here;
  // everything else falls through to the routes, and ProtectedRoute gates auth
  // for protected pages with its own loading fallback.
  if (authError?.type === 'user_not_registered' && !isAuthRoute) {
    return <UserNotRegisteredError />;
  }

  // Render the main app
  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/oauth/consent" element={<OAuthConsent />} />
      <Route path="/admin" element={<AdminLogin />} />
      <Route path="/" element={<VisaHomepage />} />
      <Route path="/about" element={<About />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="/visa/:slug" element={<DestinationPage />} />
      <Route path="/visa/:slug/:seg" element={<DestinationPage />} />
      <Route path="/search" element={<SearchResultsPage />} />
      <Route path="/tools" element={<TravelTools />} />

      <Route element={<LegalLayout />}>
        <Route path="/legal" element={<LegalDirectory />} />
        <Route path="/trust" element={<TrustCenter />} />
        {POLICIES.map((p) => <Route key={p.slug} path={p.path} element={<PolicyView slug={p.slug} />} />)}
      </Route>
      <Route path="/arrivals" element={<Navigate to="/" replace />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<CustomerShell />}>
          <Route path="/apply" element={<UnifiedWizard />} />
          <Route path="/destinations" element={<Destinations />} />
          <Route path="/destinations/:code" element={<DestinationDetail />} />
          <Route path="/applications" element={<VisaDashboard />} />
          <Route path="/applications/:id/application" element={<ApplicationWizard />} />
          <Route path="/applications/:id/workspace" element={<ApplicationWorkspace />} />
          <Route path="/applications/:id" element={<LegacyApplicationRedirect />} />
          <Route path="/applications/:id/government-form" element={<GovernmentForm />} />
          <Route path="/applications/:id/review" element={<FinalReview />} />
          <Route path="/applications/:id/status" element={<ApplicationStatus />} />
          <Route path="/orders/:order_id/confirmation" element={<OrderConfirmation />} />
          <Route path="/documents" element={<VisaDocuments />} />
          <Route path="/documents/:id" element={<DocumentDetail />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/support" element={<SupportCenter />} />
          <Route path="/help" element={<HelpCenter />} />
          <Route path="/profile/notifications" element={<NotificationPreferences />} />
          <Route path="/home" element={<AccountDashboard />} />
          <Route path="/travelers" element={<Travelers />} />
          <Route path="/trips" element={<Trips />} />
          <Route path="/account" element={<AccountSettingsPage />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/wizard/:id" element={<VisaWizard />} />
          <Route path="/cases" element={<AccountDashboard />} />
          <Route path="/cases/:id" element={<CaseDetail />} />
          <Route path="/saved" element={<SavedDestinations />} />
        </Route>

        <Route element={<RoleRoute roles={['admin']} />}>
          <Route element={<WorldzShell />}>
          <Route path="/admin/hub" element={<AdminHub />} />
          <Route path="/admin/government-forms" element={<GovernmentFormsAdmin />} />
          <Route path="/admin/submission-providers" element={<SubmissionProviders />} />
          <Route path="/ops/appointments" element={<AppointmentsOps />} />
          <Route path="/admin/support" element={<SupportAdmin />} />
          <Route path="/admin/reviews" element={<ReviewsAdmin />} />
          <Route path="/admin/visa-intelligence" element={<VisaIntelligenceAdmin />} />
          <Route path="/admin/finance" element={<AdminFinance />} />
          <Route path="/admin/operations" element={<OperationsDashboard />} />
          <Route path="/admin/operations/:caseId" element={<OperationsCase />} />
          <Route path="/admin/destination-content" element={<DestinationContentAdmin />} />
          <Route path="/admin/visa-providers" element={<VisaProviders />} />
          <Route path="/admin/country-capabilities" element={<CountryCapabilityAdmin />} />
          <Route path="/admin/cases" element={<AdminCases />} />
          <Route path="/admin/cases/:id" element={<AdminCaseDetail />} />
          <Route path="/admin/qa" element={<QACommandCenter />} />
          <Route path="/admin/system-flow-qa" element={<SystemFlowQA />} />
          <Route path="/admin/trust-compliance" element={<TrustCompliance />} />
          <Route path="/admin/help-content" element={<HelpContentAdmin />} />
          <Route path="/admin/refunds" element={<AdminRefunds />} />
          <Route path="/admin/content-audit" element={<ContentAudit />} />
          <Route path="/admin/tasks" element={<OperationsTaskQueue />} />
          <Route path="/admin/tasks/:taskId" element={<OperationsTaskDetail />} />
          <Route path="/admin/operations-command-center" element={<OperationsCommandCenter />} />
          <Route path="/admin/control-tower" element={<LaunchControlTower />} />
          <Route path="/admin/pull-requests" element={<PullRequestsAdmin />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <>
      <AppErrorBoundary>
        <AuthProvider>
          <QueryClientProvider client={queryClientInstance}>
            <Router>
              <ScrollToTop />
              <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center bg-[#f5f7fa]"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-[#006CEC]" /></div>}>
                <AuthenticatedApp />
              </Suspense>
            </Router>
            <Toaster />
          </QueryClientProvider>
        </AuthProvider>
      </AppErrorBoundary>
    </>
  )
}

export default App