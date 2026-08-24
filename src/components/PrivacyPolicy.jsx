import React from "react";

export default function PrivacyPolicy() {
  return (
    <section className="section legal-page">
      <div className="section-head">
        <p className="eyebrow">Legal</p>
        <h2>Privacy Policy</h2>
        <p className="lede">Effective date: August 24, 2026 &middot; Last updated: August 24, 2026</p>
      </div>

      <div className="legal-content">
        <p>
          This Privacy Policy explains how Ryde Fashion (&ldquo;Ryde,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;)
          collects, uses, shares, and protects information when you visit or make a purchase through rydefashion.com
          (the &ldquo;Site&rdquo;). It applies to all visitors, registered customers, and administrators of the Site.
        </p>
        <p>If you do not agree with this Policy, please do not use the Site.</p>

        <h3>1. Who We Are</h3>
        <p>
          Ryde is an online boutique offering authenticated bags, apparel, shoes, watches, perfume, makeup, wallets, and
          accessories, imported from the United States, Japan, and Canada, and sold to customers in the Philippines.
        </p>
        <ul>
          <li><strong>Business/legal name:</strong> Ryde-N Ron Fashion Jewelry Shop (a DTI-registered business name, sole proprietorship of Ronadane G. Sito), doing business as &ldquo;Ryde&rdquo;</li>
          <li><strong>Registered address:</strong> 20 JP Rizal, Arty Subdivision, Karuhatan, Valenzuela City</li>
          <li><strong>Contact email:</strong> rydecompany.ph@gmail.com</li>
        </ul>

        <h3>2. Information We Collect</h3>

        <h4>2.1 Account Information</h4>
        <p>When you create an account (by email/password or by signing in with Google), we collect:</p>
        <ul>
          <li>Full name</li>
          <li>Username</li>
          <li>Email address</li>
          <li>Phone number (optional)</li>
          <li>Authentication data managed by Firebase Authentication (see Section 5)</li>
        </ul>

        <h4>2.2 Order &amp; Checkout Information</h4>
        <p>When you place an order, we collect:</p>
        <ul>
          <li>Full name, email address, and phone number</li>
          <li>Shipping address, including province, city/municipality, barangay, and ZIP code</li>
          <li>Optional order notes</li>
          <li>Selected payment method (GCash, BDO, UnionBank, or Cash on Delivery)</li>
          <li>
            A <strong>proof-of-payment image</strong>, if you pay via GCash, BDO, or UnionBank &mdash; a screenshot or
            photo you upload to confirm your transfer, which may show partial account or transaction details from
            your bank or e-wallet
          </li>
          <li>Your order and purchase history</li>
        </ul>

        <h4>2.3 Newsletter</h4>
        <p>If you subscribe to our newsletter, we collect your email address to send you updates about new arrivals, restocks, and promotions. You can unsubscribe at any time.</p>

        <h4>2.4 Customer Support Information</h4>
        <p>When you contact us through the Support page, we collect your name, email address, subject, and message content.</p>

        <h4>2.5 Reviews and Ratings</h4>
        <p>If you submit a product review or star rating, we collect your name, star rating, and review text. Reviews you submit may be displayed publicly on product pages.</p>

        <h4>2.6 Information Collected Automatically</h4>
        <p>
          We use your browser's local storage to keep you signed in between visits (a session token is stored locally
          on your device after you log in, and removed when you log out). We do not currently use cookies, third-party
          analytics, or advertising trackers on the Site. If this changes in the future, we will update this Policy.
        </p>

        <h4>2.7 Administrator Access</h4>
        <p>
          Ryde administrators use a separate, restricted login to operate the Site (managing products, orders,
          customers, and support tickets). This Policy governs how customer data is handled by administrators, not
          the admin account itself.
        </p>

        <h3>3. How We Use Your Information</h3>
        <p>We use the information we collect to:</p>
        <ul>
          <li>Create and manage your account</li>
          <li>Process, fulfill, and ship your orders, including calculating shipping fees and coordinating delivery</li>
          <li>Verify proof-of-payment submissions and confirm orders</li>
          <li>Communicate with you about your orders, account, or support requests</li>
          <li>Send newsletter updates, if you subscribe</li>
          <li>Display product reviews and ratings you choose to submit publicly</li>
          <li>Maintain account security and prevent fraud</li>
          <li>Improve and operate the Site</li>
        </ul>
        <p>We do not sell your personal information, and we do not use your data for third-party advertising.</p>

        <h3>4. How We Share Your Information</h3>
        <ul>
          <li><strong>Shipping/courier partner:</strong> We share your name, shipping address, and phone number with our delivery courier, J&amp;T Express, so your order can be delivered.</li>
          <li><strong>Service providers:</strong> We use Firebase (Google) for account authentication and Google Sign-In.</li>
          <li><strong>Payment verification:</strong> Proof-of-payment images you upload are stored and reviewed internally to confirm your order.</li>
          <li><strong>Legal requirements:</strong> We may disclose information if required by law, regulation, legal process, or governmental request.</li>
          <li><strong>Business transfers:</strong> If Ryde is involved in a merger, acquisition, or sale of assets, customer information may be transferred as part of that transaction.</li>
        </ul>
        <p>We do not otherwise sell, rent, or trade your personal information to third parties.</p>

        <h3>5. Third-Party Services We Use</h3>
        <table className="legal-table">
          <thead>
            <tr><th>Service</th><th>Purpose</th><th>What it accesses</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Firebase Authentication (Google)</td>
              <td>Account creation, login, Google Sign-In</td>
              <td>Name, email, authentication credentials</td>
            </tr>
            <tr>
              <td>J&amp;T Express</td>
              <td>Order delivery</td>
              <td>Name, shipping address, phone number</td>
            </tr>
            <tr>
              <td>GCash / BDO / UnionBank</td>
              <td>Customer-initiated payment transfers</td>
              <td>Payment proof screenshots you choose to upload</td>
            </tr>
          </tbody>
        </table>
        <p>These providers have their own privacy practices, and we encourage you to review them.</p>

        <h3>6. Data Retention</h3>
        <p>
          We retain account information for as long as your account remains active. We retain order records,
          including proof-of-payment images, for as long as necessary to fulfill orders, address disputes, and
          comply with our legal and accounting obligations. You may request deletion of your account and associated
          personal data at any time (see Section 8), subject to records we are legally required to keep.
        </p>

        <h3>7. Data Security</h3>
        <p>
          We take reasonable technical and organizational measures to protect your information, including
          authenticated, token-based access to your account and restricting access to order, payment-proof, and
          support data to authorized personnel through the admin dashboard. No method of transmission or storage is
          100% secure, and we cannot guarantee absolute security.
        </p>

        <h3>8. Your Rights and Choices</h3>
        <p>Depending on your location, you may have rights to:</p>
        <ul>
          <li>Access the personal data we hold about you</li>
          <li>Correct inaccurate information (many fields can be updated in your Account dashboard)</li>
          <li>Request deletion of your account and personal data</li>
          <li>Object to or restrict certain processing</li>
          <li>Withdraw consent where processing is based on consent (e.g., optional phone number, newsletter)</li>
        </ul>
        <p>To exercise any of these rights, contact us at rydecompany.ph@gmail.com.</p>
        <p>
          If you are a resident of the Philippines, you also have rights under the <strong>Data Privacy Act of 2012
          (Republic Act No. 10173)</strong> and may lodge a complaint with the <strong>National Privacy Commission
          (NPC)</strong> if you believe your rights have been violated.
        </p>

        <h3>9. Children's Privacy</h3>
        <p>
          The Site is not directed to children under 13 (or the minimum age required in your jurisdiction), and we do
          not knowingly collect personal information from children. If you believe a child has provided us with
          personal information, please contact us so we can delete it.
        </p>

        <h3>10. International Users</h3>
        <p>
          Ryde ships to customers in the Philippines and sources products internationally. If you access the Site
          from outside the Philippines, your information may be processed in the Philippines or by service providers
          (such as Firebase/Google) located in other countries.
        </p>

        <h3>11. Changes to This Policy</h3>
        <p>
          We may update this Privacy Policy from time to time. We will revise the &ldquo;Last updated&rdquo; date
          above when we make changes, and material changes will be communicated through the Site or by email where
          appropriate.
        </p>

        <h3>12. Contact Us</h3>
        <p>If you have questions about this Privacy Policy or how we handle your information, contact us at:</p>
        <p>
          <strong>Email:</strong> rydecompany.ph@gmail.com<br />
          <strong>Address:</strong> 20 JP Rizal, Arty Subdivision, Karuhatan, Valenzuela City
        </p>
      </div>
    </section>
  );
}
