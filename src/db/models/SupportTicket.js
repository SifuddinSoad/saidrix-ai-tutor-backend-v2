// ===========================================
// SupportTicket Model
// One row per user-submitted contact-form message.
// Also forwarded by email to SUPPORT_INBOX_EMAIL at
// creation time, but persisted here so nothing is
// lost if SMTP is misconfigured.
// ===========================================

import mongoose from "mongoose";

const supportTicketSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    email:   { type: String, required: true, lowercase: true, trim: true },
    name:    { type: String, default: "", trim: true },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, required: true, trim: true, maxlength: 5000 },
    status: {
      type: String,
      enum: ["open", "responded", "closed"],
      default: "open",
      index: true,
    },
  },
  { timestamps: true }
);

const SupportTicket = mongoose.model("SupportTicket", supportTicketSchema);
export default SupportTicket;
