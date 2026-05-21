// ===========================================
// Project Reviewer background job
// Acquires source (git clone OR ZIP from R2), walks/filters files,
// runs the reviewer agent, persists the ProjectReview, cleans up.
// ===========================================

import fs from "fs";
import os from "os";
import path from "path";
import { simpleGit } from "simple-git";
import AdmZip from "adm-zip";

import Job from "../../db/models/Job.js";
import Project from "../../db/models/Project.js";
import ProjectReview from "../../db/models/ProjectReview.js";
import { getObjectBuffer, deleteObject } from "../../services/r2.client.js";
import { walkAndFilter } from "./fileWalker.js";
import { runReviewerAgent } from "./graph.js";
import { completeProject } from "../../services/progress.service.js";
import logger from "../../utils/logger.js";

// Score threshold above which a submission auto-completes the project.
// Configurable via env so we can tune without a code change.
const AUTO_COMPLETE_SCORE =
  Number(process.env.REVIEW_AUTO_COMPLETE_SCORE || 80);

async function setProgress(jobId, percent, message) {
  await Job.findOneAndUpdate(
    { jobId },
    { "progress.percent": percent, "progress.message": message }
  ).catch(() => {});
}

async function acquireSource(review, tmpDir) {
  fs.mkdirSync(tmpDir, { recursive: true });

  if (review.submissionType === "github") {
    const url = review.githubUrl.trim();
    if (!/^https?:\/\/.+/.test(url)) {
      throw new Error("Invalid GitHub URL");
    }
    logger.info(`[ProjectReviewer] Cloning ${url}`);
    await simpleGit().clone(url, tmpDir, ["--depth", "1"]);
    return;
  }

  if (review.submissionType === "zip") {
    if (!review.zipR2Key) throw new Error("Missing zipR2Key on review");
    const buf = await getObjectBuffer(review.zipR2Key);
    const zip = new AdmZip(buf);
    zip.extractAllTo(tmpDir, /* overwrite */ true);
    // If the zip nests everything under a single root folder, descend
    // into it so file paths look like "src/foo.js" not "MyApp/src/foo.js".
    const entries = fs.readdirSync(tmpDir).filter((n) => !n.startsWith("."));
    if (entries.length === 1) {
      const inner = path.join(tmpDir, entries[0]);
      if (fs.statSync(inner).isDirectory()) {
        for (const name of fs.readdirSync(inner)) {
          fs.renameSync(path.join(inner, name), path.join(tmpDir, name));
        }
        fs.rmdirSync(inner);
      }
    }
    return;
  }

  throw new Error(`Unknown submissionType: ${review.submissionType}`);
}

export async function processProjectReviewJob(jobId, reviewId) {
  const tmpDir = path.join(os.tmpdir(), `review-${reviewId}`);
  let review;
  try {
    await Job.findOneAndUpdate(
      { jobId },
      {
        status: "running",
        startedAt: new Date(),
        "progress.percent": 5,
        "progress.message": "Loading submission...",
      }
    );

    review = await ProjectReview.findOne({ reviewId });
    if (!review) throw new Error(`Review ${reviewId} not found`);

    review.status = "processing";
    review.startedAt = new Date();
    await review.save();

    const project = await Project.findOne({ projectId: review.projectId }).lean();
    if (!project) throw new Error(`Project ${review.projectId} not found`);

    await setProgress(jobId, 10, "Fetching source...");
    await acquireSource(review, tmpDir);

    await setProgress(jobId, 25, "Scanning files...");
    const { files, stats } = walkAndFilter(tmpDir);
    logger.info(
      `[ProjectReviewer] ${stats.reviewedFiles} files / ${stats.totalLines} lines (${stats.skippedFiles} skipped)`
    );

    await setProgress(jobId, 30, `Reviewing ${files.length} file(s)...`);

    const { issues, summary, scores, overallScore } = await runReviewerAgent({
      projectMeta: {
        project_name: project.project_name,
        description: project.description,
        requirements: project.requirements,
        skills_practiced: project.skills_practiced,
      },
      files,
      onProgress: (pct, msg) => setProgress(jobId, pct, msg),
    });

    await setProgress(jobId, 90, "Scoring...");

    review.status = "completed";
    review.completedAt = new Date();
    review.fileStats = stats;
    review.files = files.map((f) => ({
      path: f.path,
      lineCount: f.lineCount,
      bytes: f.bytes,
      content: f.content,
    }));
    review.issues = issues;
    review.scores = scores;
    review.overallScore = overallScore;
    review.summary = summary;
    await review.save();

    // Pointer + history on the project. If the score clears the
    // auto-complete bar, also flip Project.status → completed and
    // award XP (idempotent — only granted the first time).
    const passed = overallScore >= AUTO_COMPLETE_SCORE;
    const existing = await Project.findOne({
      projectId: review.projectId,
    }).select("status").lean();
    const wasAlreadyCompleted = existing?.status === "completed";

    const update = {
      latestReviewId: review.reviewId,
      $addToSet: { submissionHistory: review.reviewId },
    };
    if (passed) update.status = "completed";

    await Project.findOneAndUpdate(
      { projectId: review.projectId },
      update
    );

    if (passed) {
      try {
        const { newlyCompleted } = await completeProject(
          review.userId,
          wasAlreadyCompleted
        );
        logger.info(
          `[ProjectReviewer] Project ${review.projectId} auto-completed ` +
            `(score ${overallScore} ≥ ${AUTO_COMPLETE_SCORE}, ` +
            `XP ${newlyCompleted ? "awarded" : "already granted"})`
        );
      } catch (e) {
        logger.error(
          `[ProjectReviewer] completeProject failed: ${e.message}`
        );
      }
    } else {
      logger.info(
        `[ProjectReviewer] Project ${review.projectId} not auto-completed ` +
          `(score ${overallScore} < ${AUTO_COMPLETE_SCORE})`
      );
    }

    await Job.findOneAndUpdate(
      { jobId },
      {
        status: "completed",
        completedAt: new Date(),
        "progress.percent": 100,
        "progress.message": "Review complete",
        relatedIds: { reviewId: review.reviewId, projectId: review.projectId },
      }
    );

    logger.info(
      `[ProjectReviewer] Review ${reviewId} complete — score ${overallScore} / ${issues.length} issues`
    );
  } catch (err) {
    logger.error(`[ProjectReviewer] Job ${jobId} failed: ${err.message}`);
    if (review) {
      review.status = "failed";
      review.error = err.message;
      review.completedAt = new Date();
      await review.save().catch(() => {});
    }
    await Job.findOneAndUpdate(
      { jobId },
      { status: "failed", completedAt: new Date(), error: err.message }
    ).catch(() => {});
  } finally {
    // Cleanup tmp + R2 object (best-effort).
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    if (review?.submissionType === "zip" && review.zipR2Key) {
      deleteObject(review.zipR2Key).catch(() => {});
    }
  }
}

export default { processProjectReviewJob };
