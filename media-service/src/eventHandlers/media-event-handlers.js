const Media = require("../models/Media");
const { deleteMediaFromCloudinary } = require("../utils/cloudinary");
const logger = require("../utils/logger");
const { mediaDeleteQueue } = require("../config/bullmq");
const ProcessedEvent = require("../models/processedEvent");
const { propagation, context } = require("@opentelemetry/api");
const requestContext = require("../utils/requestContext");

// const handlePostDeleted = async (event) => {
//   console.log(event, "eventeventevent");
//   const { postId, mediaIds } = event;
//   try {
//     const mediaToDelete = await Media.find({ _id: { $in: mediaIds } });

//     // for (const media of mediaToDelete) {
//     //   await deleteMediaFromCloudinary(media.publicId);
//     //   await Media.findByIdAndDelete(media._id);

//     //   logger.info(
//     //     `Deleted medua ${media._id} associated with this deleted post ${postId}`
//     //   );
//     // }

//     await Promise.allSettled(
//       mediaToDelete.map(async (media) => {
//         await deleteMediaFromCloudinary(media.publicId);
//         await Media.findByIdAndDelete(media._id);

//         logger.info(
//           `Deleted media ${media._id} associated with post ${postId}`
//         );
//       })
//     );

//     logger.info(`Processed deletion of media for post id ${postId}`);
//   } catch (e) {
//     logger.error(e, "Error occured while media deletion");
//   }
// };

// const handlePostDeleted = async (event) => {
//   try {
//     //opt for idempotent outcome, even though the work can possibly be duplicated if 2
//     // Media Service instances accidentally receive the same event (or RabbitMQ redelivers while one is still processing)
//     //If deleteMediaFromCloudinary() treats "not found" as success, that's fine.
//     //A more advanced design would introduce a distributed lock or per-resource claim, but for media deletion, most production systems accept duplicate work because:
//     // deletes are relatively cheap,
//     // they're naturally idempotent,
//     // the final state is correct
//     //only add locking if duplicate processing became a measurable problem
//     const mediaToDelete = await Media.find({
//       postId: event.postId,
//     });

//     await Promise.all(
//       mediaToDelete.map(async (media) => {
//         await deleteMediaFromCloudinary(media.publicId); //Cloudinary deletion is idempotent

//         //await Media.findByIdAndDelete(media._id);
//         await Media.deleteOne({ _id: media._id });  //MongoDB deletion is idempotent

//         logger.info(
//           `Deleted media ${media._id} associated with post ${event.postId}`
//         );
//       })
//     );

//     logger.info(
//       `Processed media deletion for post ${event.postId}`
//     );
//   } catch (err) {
//     logger.error(
//       "Error handling post.deleted event",
//       err
//     );

//     throw err;
//   }
// };

async function handlePostDeleted(event) {
  try {
    const correlationId = requestContext.getStore()?.correlationId;

    const traceHeaders = {};

    propagation.inject(
        context.active(),
        traceHeaders
    );

    logger.info("traceHeaders just b4 adding job>>", traceHeaders);

    const media = await Media.find({
      postId: event.postId,
    });

    await Promise.all(
      media.map((item) =>
        mediaDeleteQueue.add(
          "delete-media",  //job name
          {
            mediaId: item._id.toString(),  //job data
            publicId: item.publicId,
            correlationId,
            traceHeaders,
          },
          {
            jobId: item._id.toString(),//deduplicates concurrent jobs. HOWEVER,        
                                        //Network failures, crashes after partial work, or later duplicate events can still result in the worker running more than once

            attempts: 5,

            backoff: {
              type: "exponential",
              delay: 1000,
            },

            removeOnComplete: 1000,

            removeOnFail: 5000, //false,
          }
        )
      )
    );

    logger.info(
      `Queued ${media.length} media deletions for post ${event.postId}`
    );

    try {
      await ProcessedEvent.create({
        eventId: event.eventId,
      });
    } catch (err) {
      if (err.code === 11000) {
        logger.info(`Duplicate event ${event.eventId}. Skipping.`);
        return;
      }

      throw err;
    } 
  } catch (err) {
    logger.error(
      `Error processing post.deleted event ${event.eventId}`,
      err
    );

    throw err;
  }
}

const handlePostCreated = async (event) => {
  try {
    const mediaIds = event.mediaIds ?? [];

    await Media.updateMany(
      {
        _id: {
          $in: mediaIds,
        },
        postId: null,  //to make it idempotent
      },
      {
        $set: {
          postId: event.postId,
        },
      }
    );

    logger.info(
      `Associated ${event.mediaIds.length} media with post ${event.postId}`
    );
  } catch (err) {
    logger.error(
      "Error associating media with post",
      err
    );

    throw err;
  }
};

module.exports = { handlePostDeleted, handlePostCreated };
