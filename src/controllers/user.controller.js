import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/user.model.js';
import { uploadOnCloudinary } from '../utils/cloudinary.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import jwt from 'jsonwebtoken';

const generateAccessAndRefreshTokens = async (userID) => {
    try {
        const user = await User.findById(userID);
        const accessToken = user.generateAccessToken();
        const refrenToken = user.generateRefreshToken();

        user.refrenToken = refrenToken;
        await user.save({ validateBeforeSave: false });

        return { accessToken, refrenToken };
    } catch (error) {
        throw new ApiError(500, "Something went wrong whie generationg access and refresh token");
    }
};

const registerUser = asyncHandler(async (req, res) => {
    // get user details from frontend
    // validation - not empty
    // check if user already exists: username, email
    // check for images,check for avatar
    // upload them to thecloudhinary. avtar
    // creat user object-Create entry in db
    // remove password and refresh token field from response
    // check for user creation 
    //  return response if created 



    const { fullname, email, username, password } = req.body;
    // console.log("email", email);

    if (
        [username, fullname, password, email].some((Field) => Field?.trim() === "")
    ) {
        throw new ApiError(400, "All fields are required");
    }

    const existedUser = await User.findOne({
        $or: [{ username }, { email }]
    });

    if (existedUser) {
        throw new ApiError(409, "User woth email or usename already existed");
    }
    // console.log(req.files);
    const avatarLocalPath = req.files?.avatar[0]?.path;
    // const coverImageLocalPath = req.files?.coverImage[0]?.path;

    let coverImageLocalPath;
    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files.coverImage[0].path;
    }

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required");
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath);
    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if (!avatar) {
        throw new ApiError(400, "Avatar file is required");
    }

    const user = await User.create({
        fullname,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        password,
        username: username.toLowerCase()
    });

    const createdUser = await User.findById(user._id).select(
        "-password -refrenToken"
    );

    if (!createdUser) {
        throw new ApiError(500, "Something went wrong while registering the user ");
    }


    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered Succesfully")
    );
});

const loginUser = asyncHandler(async (req, res) => {
    // req body  -> data
    // username or email based on 
    // find the user 
    // password check 
    //  access and refren token 
    // send cookies 

    const { email, username, password } = req.body;
    console.log(email);

    if (!(username || email)) {
        throw new ApiError(400, "username or eamil is required");
    }
    const user = await User.findOne({
        $or: [{ username }, { email }]
    });

    if (!user) {
        throw new ApiError(404, "User does not exist");
    }

    const isPaswordValid = await user.isPasswordCorrect(password);

    if (!isPaswordValid) {
        throw new ApiError(401, "Password incorrect");
    }

    const { accessToken, refrenToken } = await generateAccessAndRefreshTokens(user._id);

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken");

    const options = {
        httpOnly: true,
        secure: true
    };
    return res.status(200).cookie("accessToken", accessToken, options).cookie("refreshToken", refrenToken, options).json(
        new ApiResponse(
            200,
            {
                user: loggedInUser, accessToken, refrenToken
            },
            "User logged In successfully"
        )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refrenToken: undefined
            }
        },
        {
            new: true
        }
    );

    const options = {
        httpOnly: true,
        secure: true
    };

    return res.status(200).clearCookie("accessToken", options).clearCookie("refreshToken", options).json(new ApiResponse(200, {}, "User logged Out"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies.refrenToken || req.body.refrenToken;

    if (!incomingRefreshToken) {
        throw new ApiError(401, "unauthorized request");
    }
    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);

        const user = await User.findById(decodedToken?._id);

        if (!user) {
            throw new ApiError(401, "invalid refresh token");
        }

        if (incomingRefreshToken !== user?.refrenToken) {
            throw new ApiError(401, "refresh token is expired or used");
        }


        const options = {
            httpOnly: true,
            secure: true
        };

        const { accessToken, newRefrenToken } = await generateAccessAndRefreshTokens(user._id);

        return res.status(200).cookie("accessToken", accessToken, options).cookie("refreshToken", newRefrenToken, options).json(
            new ApiResponse(
                200,
                { accessToken, refrenToken: newRefrenToken },
                "Access token refreshed"
            )
        );

    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token");
    }


});

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    const user = await User.findById(req.user?._id);
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);
    if (!isPasswordCorrect) {
        throw new ApiError(400, "Invalid old password");
    }
    user.password = newPassword;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json(new ApiResponse(200, {}, "Password changed succesfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
    return res.status(200).json(new ApiResponse(200, req.user, "current user fetched successfully"));
});

const updateAccountDetails = asyncHandler(async (req, res) => {
    const { fullname, email } = req.body;

    if (!fullname || !email) {
        throw new ApiError(400, "All field are required");
    }
    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                fullname: fullname,
                email: email
            }
        },
        { new: true }
        
    ).select("-password");

    return res.status(200).json(new ApiResponse(200, user, "Account details updated successfully"));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path;

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is missing");
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath);

    if (!avatar.url) {
        throw new ApiError(400, "Error while uploading");
    }

 const user =   await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                avatar: avatar.url
            }
        },
        { new: true }
    ).select("-password")

    return res.status(200).json(
        new ApiResponse(200,user , "Avatar Image updated successfully" )
    )
});

const updateUserCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path;

    if (!coverImageLocalPath) {
        throw new ApiError(400, "cover Image  file is missing");
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if (!coverImage.url) {
        throw new ApiError(400, "Error while uploading");
    }

    const user = await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                coverImage: coverImage.url
            }
        },
        { new: true }
    ).select("-password")

    return res.status(200).json(
        new ApiResponse(200,user , "Cover Image updated successfully" )
    )
});


export { registerUser, loginUser, logoutUser, refreshAccessToken, changeCurrentPassword, getCurrentUser, updateAccountDetails, updateUserAvatar,
updateUserCoverImage }; 