import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { User } from "./entities/user.entity.js";
import { Repository } from "typeorm";
import { UpdateProfileDto } from "./dto/update-profile.dto.js";
import { AdminUpdateUserDto } from "./dto/admin-update-user.dto.js";

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User)
        private readonly usesReposity: Repository<User>,
    ) { }

    // Loại bỏ passwordHash trước khi trả về client
    sanitizeUser(user: User): Omit<User, 'passwordHash'> {
        const { passwordHash, ...safeUser } = user;
        return safeUser;
    }

    // Tìm người dùng theo số điện thoại
    async findByPhoneNumber(phoneNumber: string): Promise<User | null> {
        return this.usesReposity.findOne({
            where: {
                phoneNumber
            }
        });
    }

    // Tìm người dùng theo ID
    async findById(userId: string): Promise<User | null> {
        return this.usesReposity.findOne({
            where: {
                userId
            }
        });
    }

    // Tăng tokenVersion trong DB, nếu tokenVersion ở DB khác với ở JWT thì bị logout
    async incrementTokenVersion(userId: string): Promise<void> {
        const result = await this.usesReposity.increment(
            { userId },
            'tokenVersion',
            1
        );
        if (result.affected === 0) {
            throw new NotFoundException('Không tìm thấy người dùng!');
        }
    }

    // Đổi mật khẩu
    async upatePassword(userId: string, passwordHash: string): Promise<void> {
        const result = await this.usesReposity.update(
            { userId },
            { passwordHash }
        );
        if (result.affected === 0) {
            throw new NotFoundException('Không tìm thấy người dùng!');
        }
    }

    // Tạo người dùng mới
    async createUser(userData: Partial<User>): Promise<User> {
        const newUser = this.usesReposity.create(userData);
        return this.usesReposity.save(newUser);
    }

    // Người dùng cập nhật thông tin cá nhân (Profile)
    async updateProfile(userId: string, updateProfileDto: UpdateProfileDto): Promise<Omit<User, 'passwordHash'>> {
        const user = await this.findById(userId);
        if (!user) {
            throw new NotFoundException('Không tìm thấy người dùng!');
        }

        // Nếu thay đổi số điện thoại, kiểm tra xem số mới đã tồn tại chưa
        if (updateProfileDto.phoneNumber && updateProfileDto.phoneNumber !== user.phoneNumber) {
            const existing = await this.findByPhoneNumber(updateProfileDto.phoneNumber);
            if (existing && existing.userId !== userId) {
                throw new ConflictException('Số điện thoại này đã được sử dụng bởi tài khoản khác!');
            }
            user.phoneNumber = updateProfileDto.phoneNumber;
        }

        if (updateProfileDto.fullName !== undefined) {
            user.fullName = updateProfileDto.fullName;
        }

        const updatedUser = await this.usesReposity.save(user);
        return this.sanitizeUser(updatedUser);
    }

    // Cập nhật FCM token để nhận thông báo đẩy
    async updateFcmToken(userId: string, fcmToken: string | null): Promise<{ message: string }> {
        const user = await this.findById(userId);
        if (!user) {
            throw new NotFoundException('Không tìm thấy người dùng!');
        }

        await this.usesReposity.update({ userId }, { fcmToken });
        return { message: 'Cập nhật FCM Token thành công!' };
    }

    // Quản trị viên cập nhật thông tin/trạng thái tài khoản người dùng
    async adminUpdateUser(userId: string, adminUpdateUserDto: AdminUpdateUserDto): Promise<Omit<User, 'passwordHash'>> {
        const user = await this.findById(userId);
        if (!user) {
            throw new NotFoundException('Không tìm thấy người dùng!');
        }

        let shouldInvalidateTokens = false;

        // Nếu thay đổi số điện thoại
        if (adminUpdateUserDto.phoneNumber && adminUpdateUserDto.phoneNumber !== user.phoneNumber) {
            const existing = await this.findByPhoneNumber(adminUpdateUserDto.phoneNumber);
            if (existing && existing.userId !== userId) {
                throw new ConflictException('Số điện thoại này đã được sử dụng bởi tài khoản khác!');
            }
            user.phoneNumber = adminUpdateUserDto.phoneNumber;
        }

        if (adminUpdateUserDto.fullName !== undefined) {
            user.fullName = adminUpdateUserDto.fullName;
        }

        if (adminUpdateUserDto.role !== undefined && adminUpdateUserDto.role !== user.role) {
            user.role = adminUpdateUserDto.role;
            shouldInvalidateTokens = true;
        }

        if (adminUpdateUserDto.isActive !== undefined && adminUpdateUserDto.isActive !== user.isActive) {
            user.isActive = adminUpdateUserDto.isActive;
            if (!adminUpdateUserDto.isActive) {
                shouldInvalidateTokens = true;
            }
        }

        if (shouldInvalidateTokens) {
            user.tokenVersion = (user.tokenVersion || 0) + 1;
        }

        const savedUser = await this.usesReposity.save(user);
        return this.sanitizeUser(savedUser);
    }
}
