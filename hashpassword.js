import bcrypt from "bcrypt";

const password = "QuickjobTeam"; // your desired password
const saltRounds = 10;

const hashedPassword = await bcrypt.hash(password, saltRounds);
console.log("Hashed password:", hashedPassword);
