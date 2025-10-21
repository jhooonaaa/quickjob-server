import nodemailer from "nodemailer"; 
import dotenv from "dotenv"; 
dotenv.config(); // ✅ ensures .env variables are loaded locally


 export const sendVerificationEmail = async (email, code) => { 
const transporter = nodemailer.createTransport({ 
  service: "gmail", 
  auth: { 
    user: process.env.EMAIL_USER, // ✅ use env variable 
    pass: process.env.EMAIL_PASSWORD, // ✅ use env variable 
    }, 
  }); 
  
  await transporter.sendMail({ from: "QuickJob" <${process.env.EMAIL_USER}>,
  to: email, 
  subject: "Verify your QuickJob account", 
  text: Your verification code is: ${code}, 
}); 
};