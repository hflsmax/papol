// How a job the caller queued is getting on.
//
// The one polling endpoint for every kind of job: `queued` and `running`
// mean ask again, `done` carries the result the kind promised, `failed`
// carries a sentence for the user. A job belongs to the user whose
// request queued it; anyone else is told there is no such job.

import { currentUser } from "../auth";
import { one } from "../db";
import { json, refuse, type Router } from "../http";
import { jobOut, type Job } from "../jobs/queue";

export function jobRoutes(router: Router) {
  router.on("GET", "/api/jobs/:uuid", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const job = await one<Job>(env.DB, "SELECT * FROM jobs WHERE uuid = ?", params.uuid);
    if (!job || !job.user_uuid || job.user_uuid !== user.uuid) refuse(404, "Job not found");
    return json(jobOut(job));
  });
}
