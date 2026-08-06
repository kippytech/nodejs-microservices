const Post = require("../models/Post");
const logger = require("../utils/logger");
const { publishEvent } = require("../utils/rabbitmq");
const { validateCreatePost } = require("../utils/validation");
const { randomUUID } = require("crypto");
const OutboxEvent = require("../models/OutboxEvent");
const requestContext = require("../utils/requestContext");
const mongoose = require("mongoose");
const { propagation, context, trace, SpanStatusCode } = require("@opentelemetry/api");

const tracer = trace.getTracer(process.env.SERVICE_NAME);

async function invalidateSinglePostCache(req, postId) {
    //await req.redisClient.del(`posts:item:${postId}`);
    await req.redisClient.unlink(`posts:item:${postId}`);
}

// async function invalidatePostCache(req) {
//   // const cachedKey = `post:${input}`;
//   // await req.redisClient.del(cachedKey);

//   const keys = await req.redisClient.keys("posts:list:*");
//   if (keys.length > 0) {
//     await req.redisClient.del(keys);
//   }
// }
// async function invalidatePostCache(req) {
//   const cachedKey = `post:${input}`;
//   await req.redisClient.del(cachedKey);

//   const keys = await req.redisClient.keys("posts:list:*");
//   if (keys.length > 0) {
//     await req.redisClient.del(keys);
//   }
// }

async function invalidatePostListCache(req) {
  // KEYS is discouraged in production because it scans the entire Redis keyspace and can block Redis if you have lots of keys.
  // The recommended approach is to use SCAN, which iterates incrementally without blocking the server.
  const stream = req.redisClient.scanStream({
    match: "posts:list:*",
    count: 100,
  });

  // stream is an array of keys
  // Redis gradually sends batches of matching keys, wait for each batch, then add every key from that batch into the keys array so that, by the end, keys contains one flat list of all matching cache keys

  const keys = [];

  for await (const resultKeys of stream) {
    keys.push(...resultKeys);
  }

  if (keys.length > 0) {
    await req.redisClient.unlink(...keys); //UNLINK removes the keys immediately from Redis' namespace but frees the memory asynchronously in the background. For large keys, this avoids blocking Redis. (BETTER THAN DELETE)
  }

  // an even more scalable approach is to avoid scanning entirely.
  // use a Redis Set containing all post-list cache keys: 
  // await req.redisClient.set(
  //   cacheKey,
  //   JSON.stringify(result),
  //   "EX",
  //   300
  // );
  // await req.redis.sadd("post:list:cache:keys", cacheKey);
  // THEN 
  // const keys = await redis.smembers("post:list:cache:keys");

  // if (keys.length) {
  //   await redis.unlink(...keys);
  //   await redis.del("post:list:cache:keys");
  // }
}

//you can compose them. Then controllers become very expressive
// eg CREATE --> await invalidatePostListCache(req);
// eg UPDATE / DELETE --> await invalidatePostCaches(req, postId);
async function invalidatePostCaches(req, postId) {
  await Promise.all([
    invalidateSinglePostCache(req, postId),
    invalidatePostListCache(req),
  ]);
}
const createPost = async (req, res) => {
  logger.info("Create post endpoint hit");

  const session = await mongoose.startSession();

  await tracer.startActiveSpan(
    "Create Post",
    async (span) => {
      try {
        //validate the schema
        const { error } = validateCreatePost(req.body);
        if (error) {
          logger.warn("Validation error", error.details[0].message);
          return res.status(400).json({
            success: false,
            message: error.details[0].message,
          });
        }
        const { content, mediaIds } = req.body;

        session.startTransaction();

        const newlyCreatedPost = new Post({
          user: req.user.userId,
          content,
          mediaIds: mediaIds || [],
        });

        //await newlyCreatedPost.save();;
        await newlyCreatedPost.save({ session });

        // await publishEvent("post.created", {
        //   eventId: randomUUID(),
        //   eventType: "post.created",
        //   occurredAt: new Date().toISOString(),

        //   postId: newlyCreatedPost._id.toString(),
        //   userId: newlyCreatedPost.user.toString(),
        //   content: newlyCreatedPost.content,
        //   createdAt: newlyCreatedPost.createdAt,
        // });

        const traceHeaders = {};

        propagation.inject(
          context.active(),
          traceHeaders
        );

        const event = {
          eventId: randomUUID(),
          eventType: "post.created",
          occurredAt: new Date().toISOString(),

          postId: newlyCreatedPost._id.toString(),
          userId: newlyCreatedPost.user.toString(),
          content: newlyCreatedPost.content,
          createdAt: newlyCreatedPost.createdAt,
          
          mediaIds: newlyCreatedPost.mediaIds
        };

        const outboxEvent = new OutboxEvent({
          eventId: event.eventId,
          eventType: event.eventType,
          occurredAt: event.occurredAt,

          correlationId: requestContext.getStore()?.correlationId,
          traceHeaders,

          payload: {
            postId: event.postId,
            userId: event.userId,
            content: event.content,
            createdAt: event.createdAt,

            mediaIds: event.mediaIds,
          },
        });

        await outboxEvent.save({ session });

        await session.commitTransaction();

        //await invalidatePostCache(req, newlyCreatedPost._id.toString());
        await invalidatePostListCache(req);
        logger.info("Post created successfully", {
          postId: newlyCreatedPost._id,
        });

        span.setAttributes({
          "post.id": newlyCreatedPost._id.toString(),
          "user.id": req.user.userId,
        });

        span.setStatus({
          code: SpanStatusCode.OK,
        });

        res.status(201).json({
          success: true,
          message: "Post created successfully",
          post: newlyCreatedPost
        });
      } catch (e) {
        if (session.inTransaction()) {
          await session.abortTransaction();
        }

        logger.error("Error creating post", e);

        span.recordException(e);

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: e.message,
        });

        res.status(500).json({
          success: false,
          message: "Error creating post",
        });
      } finally {
        await session.endSession();
        span.end();
      }
    })
};

const getAllPosts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const startIndex = (page - 1) * limit;

    //const cacheKey = `posts:${page}:${limit}`;
    const cacheKey = `posts:list:page:${page}:limit:${limit}`;
    //const cachedPosts = await req.redisClient.get(cacheKey);
    let cachedPosts = null;
    try {
      cachedPosts = await req.redisClient.get(cacheKey);
    } catch (err) {
      logger.warn("Redis cache unavailable", {
        error: err.message,
      });
    }

    if (cachedPosts) {
      return res.json(JSON.parse(cachedPosts));
    }

    const posts = await Post.find({})
      .sort({ createdAt: -1 })
      .skip(startIndex)
      .limit(limit);

    const totalNoOfPosts = await Post.countDocuments();

    const result = {
      posts,
      currentpage: page,
      totalPages: Math.ceil(totalNoOfPosts / limit),
      totalPosts: totalNoOfPosts,
    };

    //await req.redisClient.setex(cacheKey, 300, JSON.stringify(result));
    try {
      await req.redisClient.set(
        cacheKey,
        JSON.stringify(result),
        "EX",
        300
      );
    } catch (e) {
      logger.warn("Failed to write cache", {error: e.message,})
    }

    res.json(result);
  } catch (e) {
    logger.error("Error fetching posts", error);
    res.status(500).json({
      success: false,
      message: "Error fetching posts",
    });
  }
};

const getPost = async (req, res) => {
  try {
    const postId = req.params.id;
    //const cachekey = `post:${postId}`;
    const cachekey = `posts:item:${postId}`;
    //const cachedPost = await req.redisClient.get(cachekey);
    let cachedPost = null;
    try {
      cachedPost = await req.redisClient.get(cacheKey);
    } catch (err) {
      logger.warn("Redis cache unavailable", {
        error: err.message,
      });
    }

    if (cachedPost) {
      return res.json(JSON.parse(cachedPost));
    }

    const singlePostDetailsbyId = await Post.findById(postId);

    if (!singlePostDetailsbyId) {
      return res.status(404).json({
        message: "Post not found",
        success: false,
      });
    }

    // await req.redisClient.setex(
    //   cachekey,
    //   3600,
    //   JSON.stringify(singlePostDetailsbyId)
    // );
    try {
      await req.redisClient.set(
        cachekey,
        JSON.stringify(singlePostDetailsbyId),
        "EX",
        3600
      );
    } catch (e) {
      logger.warn("Failed to write cache", {error: e.message,})
    }

    res.json(singlePostDetailsbyId);
  } catch (e) {
    logger.error("Error fetching post", error);
    res.status(500).json({
      success: false,
      message: "Error fetching post by ID",
    });
  }
};

// const deletePost = async (req, res) => {
//   try {
//     const post = await Post.findOneAndDelete({
//       _id: req.params.id,
//       user: req.user.userId,
//     });

//     if (!post) {
//       return res.status(404).json({
//         message: "Post not found",
//         success: false,
//       });
//     }

//     //publish post delete method ->
//     await publishEvent("post.deleted", {
//       postId: post._id.toString(),
//       userId: req.user.userId,
//       mediaIds: post.mediaIds,
//     });

//     //await invalidatePostCache(req, req.params.id);
//     await invalidatePostCaches(req, req.params.id);
//     res.json({
//       message: "Post deleted successfully",
//     });
//   } catch (e) {
//     logger.error("Error deleting post", e);
//     res.status(500).json({
//       success: false,
//       message: "Error deleting post",
//     });
//   }
// };

const deletePost = async (req, res) => {
  const session = await mongoose.startSession();

  await tracer.startActiveSpan(
    "Delete Post",
    async (span) => {
      try {
        session.startTransaction();

        const post = await Post.findOneAndDelete(
          {
            _id: req.params.id,
            user: req.user.userId,
          },
          { session }
        );

        if (!post) {
          await session.abortTransaction();

          return res.status(404).json({
            success: false,
            message: "Post not found",
          });
        }

        const traceHeaders = {};

        propagation.inject(
          context.active(),
          traceHeaders
        );

        logger.info({traceHeaders: traceHeaders});

        const event = {
          eventId: randomUUID(),
          eventType: "post.deleted",
          occurredAt: new Date().toISOString(),

          postId: post._id.toString(),
          userId: req.user.userId,
        };

        const outboxEvent = new OutboxEvent({
          eventId: event.eventId,
          eventType: event.eventType,
          occurredAt: event.occurredAt,

          correlationId: requestContext.getStore()?.correlationId,
          traceHeaders,

          payload: {
            postId: event.postId,
            userId: event.userId,
            //removed mediaIds from the event, since with the revised design the Media Service will look up media by postId
          },
        });

        await outboxEvent.save({ session });

        const saved = await OutboxEvent.findById(outboxEvent._id).session(session);

        logger.info("Saved headers", saved.traceHeaders);

        await session.commitTransaction();

        await invalidatePostCaches(req, req.params.id);

        logger.info(`Post ${post._id} deleted successfully`);

        span.setAttributes({
          "post.id": post._id.toString(),
          "user.id": req.user.userId,
        });

        span.setStatus({
          code: SpanStatusCode.OK,
        });

        res.json({
          success: true,
          message: "Post deleted successfully",
        });
      } catch (err) {
        await session.abortTransaction();

        logger.error("Error deleting post", err);

        span.recordException(err);

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err.message,
        });

        res.status(500).json({
          success: false,
          message: "Error deleting post",
        });
      } finally {
        await session.endSession();
        span.end();
      }
  })
};

module.exports = { createPost, getAllPosts, getPost, deletePost };
