const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    // jti: {
    // type: String,
    // required: true,
    // unique: true   // can replace the token field if we are using jwt
    // },
    // revoked: {
    // type: Boolean,
    // default: false
    // },  //Allows immediate invalidation without waiting for expiration.
    // revokedAt: {
    //   type: Date,
    //   default: null,
    // },  // for audting,
    // userAgent: {
    //   type: String,
    //   trim: true,
    // },
    // ipAddress: {
    //   type: String,
    // },
    // lastUsedAt, // see inactive sessions
    // familyId, //If an old token is reused after rotation (a sign it may have been stolen), the server can invalidate the entire family
    // rotatedFrom, //help detect replay attacks
    // deviceName,
  },
  { timestamps: true }
);

// TTL index to automatically delete expired refresh tokens
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// // for revocation, we can create an index on the user field to quickly find all refresh tokens for a specific user....RefreshToken.deleteMany({ user: userId });
// refreshTokenSchema.index({ user: 1 });

const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);
module.exports = RefreshToken;
