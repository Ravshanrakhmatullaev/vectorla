import { Link } from '@/components/ui/Link'
import { Decision, LegalLayout, LegalSection } from '@/pages/legal/LegalLayout'

// Draft. Every statement here describes how the code in this repository
// behaves today; open business/legal choices are marked with <Decision>.
// Keep it in sync with the product (e.g. if analytics or a new processor is
// added, this page must change first).
export function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy" updated="Draft of 3 October 2026">
      <LegalSection title="Who we are">
        <p>
          Vectorla (“we”, “us”) is an online service that converts raster images into vector (SVG) files. Vectorla is
          operated by <Decision>legal name and registered address of the operator</Decision>. For privacy questions,
          contact <Decision>privacy contact email</Decision>.
        </p>
      </LegalSection>

      <LegalSection title="What we collect">
        <ul>
          <li>
            <strong>Account data:</strong> your email address and a password. Passwords are handled by our
            authentication provider and are not stored by us in readable form.
          </li>
          <li>
            <strong>Images you upload and the files we generate:</strong> the original image, the resulting SVG, and
            details about them (file name, type, size, processing status and timestamps).
          </li>
          <li>
            <strong>Credits:</strong> your credit balance and a record of credits added, used and refunded.
          </li>
          <li>
            <strong>Technical data:</strong> our servers log each request (time, address requested, result and a
            request ID) to keep the service running and to investigate errors. Our hosting provider may also process
            your IP address and browser information to deliver and protect the service.
          </li>
          <li>
            <strong>Data stored in your browser:</strong> your sign-in session, and your language and theme
            preferences. We do not use advertising or analytics cookies.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="How we use it">
        <ul>
          <li>To trace your images and let you download the results.</li>
          <li>To run your account and keep track of your credits.</li>
          <li>To keep the service secure, prevent abuse, and fix problems.</li>
          <li>To send emails needed for your account, such as confirming your address or resetting your password.</li>
        </ul>
        <p>
          We do not sell your data, and we do not show advertising. Vectorla’s tracing engine does not use your images
          to train machine-learning models. Legal basis for processing, where required by law:{' '}
          <Decision>applicable law and legal bases, e.g. performance of a contract and legitimate interests</Decision>.
        </p>
      </LegalSection>

      <LegalSection title="Who processes your data for us">
        <p>We use these service providers to run Vectorla. They process data only to provide their service to us:</p>
        <ul>
          <li>
            <strong>Cloudflare</strong> — hosting of the website and API, processing, and storage of uploaded images
            and generated files.
          </li>
          <li>
            <strong>Supabase</strong> — account sign-in and our database (account, file details and credits). Database
            region: <Decision>confirm the production database region; currently Seoul, South Korea</Decision>.
          </li>
          <li>
            <strong>Google Fonts</strong> — the website loads fonts from Google, which receives your IP address when the
            page loads.
          </li>
          <li>
            <strong>Email delivery</strong> — <Decision>name of the email provider used for account emails</Decision>.
          </li>
        </ul>
        <p>
          These providers may process data in countries other than your own.{' '}
          <Decision>international transfer safeguards required by the applicable law</Decision>
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <ul>
          <li>
            <strong>Uploaded images and generated files:</strong> deleted automatically 30 days after the image was
            uploaded. Deletion runs on a schedule, so a file can remain for a short time after the 30 days have passed.
            You can ask us to delete them sooner.
          </li>
          <li>
            <strong>Server request logs:</strong> kept for no longer than 30 days.
          </li>
          <li>
            <strong>Account data and credit records:</strong> kept while your account exists, and deleted when your
            account is deleted.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Your choices and rights">
        <p>
          You can ask us for a copy of your data, to correct it, or to delete your account and files by contacting{' '}
          <Decision>privacy contact email</Decision>. There is no self-service account deletion yet. Depending on where
          you live, you may have further rights, including complaining to your data protection authority.{' '}
          <Decision>list of rights and response time under the applicable law</Decision>
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Data is sent over encrypted connections (HTTPS). Your files and credit records are only accessible to your
          own account, and download links are signed and expire. No system is completely secure, so we cannot
          guarantee absolute security.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          Vectorla is not intended for children under <Decision>minimum age, e.g. 16</Decision>, and we do not knowingly
          collect their data.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We will update this page when our practices change and show the date of the latest version at the top. See
          also our{' '}
          <Link href="/terms" className="font-medium text-[var(--accent)] hover:underline">
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
