// ===========================================
// KnowledgeDoc Model
// RAG knowledge base — pre-loaded subject-tagged
// documents queryable by course-maker agent
// ===========================================

import mongoose from "mongoose";

// --- Knowledge Document Schema ---

const knowledgeDocSchema = new mongoose.Schema(
  {
    // Unique document identifier
    docId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Subject category (e.g., "LangChain", "React", "Python")
    subject: {
      type: String,
      required: true,
      index: true,
    },

    // Document title
    title: { type: String, required: true },

    // Actual document content (the text body)
    content: { type: String, required: true },

    // Source URL or origin
    source: { type: String, default: "" },

    // Tags for additional filtering
    tags: { type: [String], default: [] },

    // Future: vector embedding for semantic search
    // embedding: { type: [Number], default: undefined },

    // Flexible metadata
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  }
);

// --- Text Index for Full-Text Search ---
// Allows MongoDB text search across title, content, and tags

knowledgeDocSchema.index({
  title: "text",
  content: "text",
  tags: "text",
});

// --- Export ---

const KnowledgeDoc = mongoose.model("KnowledgeDoc", knowledgeDocSchema);
export default KnowledgeDoc;
