import { Link } from '@/components/ui/Link'
import { Decision, LegalLayout, LegalSection } from '@/pages/legal/LegalLayout'

// Draft. Open business/legal choices are marked with <Decision>. Nothing here
// describes paid plans, because none exist yet.
export function TermsOfService() {
  return (
    <LegalLayout title="Terms of Service" updated="Draft of 3 October 2026">
      <LegalSection title="About these terms">
        <p>
          These terms apply to your use of Vectorla, an online service that converts raster images into vector (SVG)
          files. Vectorla is operated by <Decision>legal name and registered address of the operator</Decision>. By
          creating an account or using the service, you agree to these terms.
        </p>
      </LegalSection>

      <LegalSection title="Your account">
        <ul>
          <li>
            You must be at least <Decision>minimum age, e.g. 16</Decision> to use Vectorla.
          </li>
          <li>Keep your password secure. You are responsible for activity on your account.</li>
          <li>One person should not create multiple accounts to obtain extra free credits.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Credits">
        <ul>
          <li>Tracing an image uses credits: currently 1 credit for a Quick Trace and 2 for a Professional Trace.</li>
          <li>If a trace fails, the credits used for it are returned to your balance automatically.</li>
          <li>
            Free credits have no cash value, cannot be transferred or exchanged for money, and may be changed or
            withdrawn for future signups.
          </li>
          <li>
            Paid plans and credit purchases are not available yet. If they are introduced, their prices and terms will
            be shown before you pay. <Decision>whether unused credits expire</Decision>
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Your content">
        <ul>
          <li>You keep all rights you have in the images you upload and in the files Vectorla generates from them.</li>
          <li>
            You give us permission to store, process and convert your uploads only as needed to provide the service to
            you.
          </li>
          <li>
            Only upload images you have the right to use. Converting a logo or artwork does not give you rights in it;
            respecting trademarks and copyrights is your responsibility.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>You must not use Vectorla to:</p>
        <ul>
          <li>upload illegal content, or content that infringes someone else’s rights;</li>
          <li>upload malware or files designed to harm the service;</li>
          <li>overload, disrupt, or try to bypass the limits or security of the service;</li>
          <li>access other people’s accounts or data.</li>
        </ul>
        <p>We may suspend or close accounts that break these rules.</p>
      </LegalSection>

      <LegalSection title="Results and availability">
        <p>
          Automatic tracing is not perfect. Check each result before you use it, especially before printing or cutting.
          The service is provided “as is” and “as available”: we do not promise that it will always be available,
          error-free, or suitable for a particular purpose. We may change or discontinue features.
        </p>
      </LegalSection>

      <LegalSection title="Liability">
        <p>
          To the extent permitted by law, we are not liable for indirect or consequential losses, or for loss of data,
          profits or business. <Decision>liability cap and consumer-law carve-outs under the applicable law</Decision>
        </p>
      </LegalSection>

      <LegalSection title="Ending your use">
        <p>
          You can stop using Vectorla at any time and ask us to delete your account. We may close accounts that break
          these terms. <Decision>notice period, if any, for closing accounts or shutting down the service</Decision>
        </p>
      </LegalSection>

      <LegalSection title="Changes and governing law">
        <p>
          We may update these terms; we will show the date of the latest version at the top and tell you about
          significant changes. These terms are governed by <Decision>governing law and competent courts</Decision>.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about these terms: <Decision>support contact email</Decision>. How we handle your data is explained
          in our{' '}
          <Link href="/privacy" className="font-medium text-[var(--accent)] hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
