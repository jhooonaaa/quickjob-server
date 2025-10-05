import nodemailer from "nodemailer";

export const sendVerificationEmail = async (email, code) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "yourgmail@gmail.com",
      pass: "yourapppassword", // use App Password
    },
  });

  await transporter.sendMail({
    from: '"QuickJob" <yourgmail@gmail.com>',
    to: email,
    subject: "Verify your QuickJob account",
    text: `Your verification code is: ${code}`,
  });
};
