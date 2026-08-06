const mongoose = require("mongoose");

const mediaSchema = new mongoose.Schema(
  {
    publicId: {
      type: String,
      required: true,
    },
    originalName: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      //required: true,
      default: null,
      //index: true,
    },
  },
  { timestamps: true }
);

mediaSchema.index({userId: 1})
mediaSchema.index({postId: 1})

const Media = mongoose.model("Media", mediaSchema);

module.exports = Media;
