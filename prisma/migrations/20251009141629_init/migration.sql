-- CreateTable
CREATE TABLE `sessions` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastActivity` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `metadata` JSON NULL,

    UNIQUE INDEX `sessions_sessionId_key`(`sessionId`),
    INDEX `sessions_sessionId_idx`(`sessionId`),
    INDEX `sessions_lastActivity_idx`(`lastActivity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transports` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `transportType` VARCHAR(191) NOT NULL DEFAULT 'http',
    `state` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `transports_sessionId_key`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `session_logs` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `level` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `session_logs_sessionId_idx`(`sessionId`),
    INDEX `session_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tool_usage` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NULL,
    `toolName` VARCHAR(191) NOT NULL,
    `operation` VARCHAR(191) NOT NULL,
    `duration` INTEGER NULL,
    `success` BOOLEAN NOT NULL DEFAULT true,
    `errorMessage` TEXT NULL,
    `requestSize` INTEGER NULL,
    `responseSize` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tool_usage_toolName_idx`(`toolName`),
    INDEX `tool_usage_createdAt_idx`(`createdAt`),
    INDEX `tool_usage_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `transports` ADD CONSTRAINT `transports_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`sessionId`) ON DELETE CASCADE ON UPDATE CASCADE;
