import sendgrid from "@sendgrid/mail";
import dotenv from "dotenv";
dotenv.config(); // make sure .env is loaded

// Set SendGrid API key
sendgrid.setApiKey(process.env.SENDGRID_API_KEY);

// Helper function to send verification email
export const sendVerificationEmail = async (email, code) => {
  try {
    await sendgrid.send({
      to: email,
      from: {
        email: "quickjobwebsite@gmail.com", // must match your verified sender in SendGrid
        name: "QuickJob",
      },
      subject: "Verify your QuickJob account",
      text: `Your verification code is: ${code}`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <h2>QuickJob Verification</h2>
          <p>Your verification code is:</p>
          <h3 style="color:#eab308">${code}</h3>
          <p>Please enter this code to verify your account.</p>
        </div>
      `,
    });

    console.log(`✅ Verification email sent to ${email}`);
  } catch (error) {
    console.error("❌ Failed to send email:", error);
    if (error.response) {
      console.error(error.response.body);
    }
  }
};
