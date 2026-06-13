import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendPaymentSuccessEmail(email: string, amount: number, credits: number) {
  try {
    await resend.emails.send({
      from: 'RepoFlow AI <noreply@repoflow.ai>',
      to: email,
      subject: 'Payment Successful - Credits Added',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0ea5e9;">Payment Successful!</h1>
          <p>Thank you for your purchase. Your credits have been added to your account.</p>
          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;"><strong>Amount:</strong> $${amount}</p>
            <p style="margin: 10px 0 0;"><strong>Credits Added:</strong> ${credits}</p>
          </div>
          <p>You can now use these credits for your projects.</p>
          <p style="color: #6b7280; font-size: 14px;">If you have any questions, please contact our support team.</p>
        </div>
      `,
    });
  } catch (error) {
    console.error('Failed to send payment success email:', error);
  }
}

export async function sendPaymentFailedEmail(email: string, amount: number, error: string) {
  try {
    await resend.emails.send({
      from: 'RepoFlow AI <noreply@repoflow.ai>',
      to: email,
      subject: 'Payment Failed - Action Required',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #ef4444;">Payment Failed</h1>
          <p>We were unable to process your payment. Here are the details:</p>
          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0;"><strong>Amount:</strong> $${amount}</p>
            <p style="margin: 10px 0 0;"><strong>Error:</strong> ${error}</p>
          </div>
          <p>Please try again or contact our support team if the issue persists.</p>
          <p style="color: #6b7280; font-size: 14px;">If you have any questions, please contact our support team.</p>
        </div>
      `,
    });
  } catch (error) {
    console.error('Failed to send payment failed email:', error);
  }
}
