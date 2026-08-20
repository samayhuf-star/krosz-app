// Traveler-facing label maps mirroring the pure presentation module. Kept on the
// client for rendered cards BEFORE the server context projection loads; the server
// `application-case-context` action (buildContext) remains the authoritative source.
export const CASE_STATE_LABELS = {
  DRAFT: 'Application started',
  INTAKE: 'Getting your details',
  ELIGIBILITY_REVIEW: 'Checking eligibility',
  DOCUMENTS_REQUIRED: 'Documents required',
  DOCUMENTS_REVIEW: 'Documents under review',
  READY_FOR_SUBMISSION: 'Ready for submission',
  REVIEW_REQUIRED: 'Review required',
  SUBMISSION_PENDING: 'Preparing submission',
  SUBMITTED: 'Application submitted',
  PROCESSING: 'Application processing',
  ADDITIONAL_INFORMATION_REQUIRED: 'Action required',
  APPROVED: 'Visa approved',
  REJECTED: 'Application not approved',
  CANCELLED: 'Application cancelled',
  EXPIRED: 'Application expired',
  COMPLETED: 'Application completed',
};

export const NEXT_ACTIONS = {
  DRAFT: 'Continue your application',
  INTAKE: 'Add travel details',
  ELIGIBILITY_REVIEW: 'Continue to documents',
  DOCUMENTS_REQUIRED: 'Upload documents',
  DOCUMENTS_REVIEW: 'Wait for document review',
  READY_FOR_SUBMISSION: 'Review and continue',
  REVIEW_REQUIRED: 'Review application',
  SUBMISSION_PENDING: 'Prepare submission',
  SUBMITTED: 'Track application',
  PROCESSING: 'View application status',
  ADDITIONAL_INFORMATION_REQUIRED: 'Provide additional information',
  APPROVED: 'View visa',
  REJECTED: 'No further action required',
  CANCELLED: 'Application cancelled',
  EXPIRED: 'Start a new application',
  COMPLETED: 'View completed application',
};