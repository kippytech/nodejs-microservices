const Search = require("../models/Search");
const logger = require("../utils/logger");
const ProcessedEvent = require("../models/ProcessedEvent");
const mongoose = require("mongoose")

// async function handlePostCreated(event) {
//   try {

//     const newSearchPost = new Search({
//       postId: event.postId,
//       userId: event.userId,
//       content: event.content,
//       createdAt: event.createdAt,
//     });

//     await newSearchPost.save();
//     logger.info(
//       `Search post created: ${event.postId}, ${newSearchPost._id.toString()}`
//     );
//   } catch (e) {
//     logger.error(e, "Error handling post creation event");
//   }
// }

async function handlePostCreated(event) {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // // The unique index on eventId ensures only one consumer can succeed.
    try {
      const processedEvent = new ProcessedEvent({
        eventId: event.eventId,
      });

      await processedEvent.save({ session });
    } catch (err) {
      // Duplicate event => already processed
      if (err.code === 11000) {
        await session.abortTransaction();

        logger.info(
          `Ignoring duplicate event ${event.eventId}`
        );

        return;
      }

      throw err;
    }

    const newSearchPost = new Search({
      postId: event.postId,
      userId: event.userId,
      content: event.content,
      createdAt: event.createdAt,
    });

    await newSearchPost.save({ session });

    await session.commitTransaction();

    logger.info(
      `Search post created: ${event.postId}, ${newSearchPost._id.toString()}`
    );
  } catch (e) {
    await session.abortTransaction();

    logger.error("Error handling post creation event", e);

    throw e;
  } finally {
    await session.endSession();
  }
}

// async function handlePostDeleted(event) {
//   try {
//     await Search.findOneAndDelete({ postId: event.postId });
//     logger.info(`Search post deleted: ${event.postId}}`);
//   } catch (error) {
//     logger.error(error, "Error handling post deletion event");
//   }
// }
async function handlePostDeleted(event) {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // Register this event.
    // Duplicate key => event has already been processed.
    const processedEvent = new ProcessedEvent({
      eventId: event.eventId,
    });

    try {
      await processedEvent.save({ session });
    } catch (err) {
      if (err.code === 11000) {
        await session.abortTransaction();

        logger.info(
          `Ignoring duplicate event ${event.eventId}`
        );

        return;
      }

      throw err;
    }

    await Search.findOneAndDelete(
      { postId: event.postId },
      { session }
    );

    await session.commitTransaction();

    logger.info(
      `Search post deleted: ${event.postId}`
    );
  } catch (err) {
    await session.abortTransaction();

    logger.error(
      "Error handling post deletion event",
      err
    );

    throw err;
  } finally {
    await session.endSession();
  }
}

module.exports = { handlePostCreated, handlePostDeleted };
