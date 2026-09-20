import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity.js';
import { EntityManager, FindOptionsWhere, ILike, Repository } from 'typeorm';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { FindUsersQueryDto } from './dto/find-users-query.dto.js';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  // Loại bỏ passwordHash trước khi trả về client
  sanitizeUser(user: User): Omit<User, 'passwordHash'> {
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  }

  // Tìm người dùng theo số điện thoại
  async findByPhoneNumber(phoneNumber: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: {
        phoneNumber,
      },
    });
  }

  // Tìm người dùng theo email
  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: {
        email,
      },
    });
  }

  // Tìm người dùng theo ID
  async findById(userId: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: {
        userId,
      },
    });
  }

  // Lấy danh sách tất cả người dùng (hỗ trợ tìm kiếm, lọc theo vai trò, phân trang)
  async findAll(query: FindUsersQueryDto): Promise<{
    data: Omit<User, 'passwordHash'>[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { page = 1, limit = 10, search, role } = query;
    const skip = (page - 1) * limit;

    let where: FindOptionsWhere<User>[] | FindOptionsWhere<User> = {};

    if (search) {
      where = [
        {
          fullName: ILike(`%${search}%`),
          ...(role ? { role } : {}),
        },
        {
          phoneNumber: ILike(`%${search}%`),
          ...(role ? { role } : {}),
        },
        {
          email: ILike(`%${search}%`),
          ...(role ? { role } : {}),
        },
      ];
    } else if (role) {
      where = { role };
    }

    const [users, total] = await this.usersRepository.findAndCount({
      where,
      order: { fullName: 'ASC' },
      skip,
      take: limit,
    });

    return {
      data: users.map((u) => this.sanitizeUser(u)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Tăng tokenVersion trong DB, nếu tokenVersion ở DB khác với ở JWT thì bị logout
  async incrementTokenVersion(
    userId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const repo = manager ? manager.getRepository(User) : this.usersRepository;

    const result = await repo.increment({ userId }, 'tokenVersion', 1);

    if (result.affected === 0) {
      throw new NotFoundException('Không tìm thấy người dùng!');
    }

    const updatedUser = await repo.findOne({
      where: { userId },
    });

    if (!updatedUser) {
      throw new NotFoundException('Không tìm thấy người dùng!');
    }

    return updatedUser.tokenVersion;
  }

  // Đổi mật khẩu
  async updatePassword(
    userId: string,
    passwordHash: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(User) : this.usersRepository;
    const result = await repo.update(
      { userId },
      { passwordHash, mustChangePassword: false },
    );
    if (result.affected === 0) {
      throw new NotFoundException('Không tìm thấy người dùng!');
    }
  }

  // Tạo người dùng mới (internal / auth)
  async createUser(
    userData: Partial<User>,
    manager?: EntityManager,
  ): Promise<User> {
    const repo = manager ? manager.getRepository(User) : this.usersRepository;
    const newUser = repo.create(userData);
    return repo.save(newUser);
  }

  // Quản trị viên tạo người dùng mới
  async createUserByAdmin(
    dto: CreateUserDto,
  ): Promise<Omit<User, 'passwordHash'>> {
    const existing = await this.findByPhoneNumber(dto.phoneNumber);
    if (existing) {
      throw new ConflictException('Số điện thoại này đã được đăng ký!');
    }

    if (dto.email) {
      const existingEmail = await this.findByEmail(dto.email);
      if (existingEmail) {
        throw new ConflictException(
          'Email này đã được sử dụng bởi tài khoản khác!',
        );
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const newUser = this.usersRepository.create({
      fullName: dto.fullName,
      phoneNumber: dto.phoneNumber,
      passwordHash,
      email: dto.email || null,
      gender: dto.gender || null,
      dateOfBirth: dto.dateOfBirth || null,
      role: dto.role,
      mustChangePassword: dto.mustChangePassword ?? false,
    });

    const savedUser = await this.usersRepository.save(newUser);
    return this.sanitizeUser(savedUser);
  }

  // Người dùng cập nhật thông tin cá nhân (Profile)
  async updateProfile(
    userId: string,
    updateProfileDto: UpdateProfileDto,
  ): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng!');
    }

    // Nếu thay đổi số điện thoại, kiểm tra xem số mới đã tồn tại chưa
    if (
      updateProfileDto.phoneNumber &&
      updateProfileDto.phoneNumber !== user.phoneNumber
    ) {
      const existing = await this.findByPhoneNumber(
        updateProfileDto.phoneNumber,
      );
      if (existing && existing.userId !== userId) {
        throw new ConflictException(
          'Số điện thoại này đã được sử dụng bởi tài khoản khác!',
        );
      }
      user.phoneNumber = updateProfileDto.phoneNumber;
    }

    if (updateProfileDto.fullName !== undefined) {
      user.fullName = updateProfileDto.fullName;
    }

    // Nếu thay đổi email, kiểm tra xem email mới đã tồn tại chưa
    if (updateProfileDto.email !== undefined) {
      if (updateProfileDto.email && updateProfileDto.email !== user.email) {
        const existingEmail = await this.findByEmail(updateProfileDto.email);
        if (existingEmail && existingEmail.userId !== userId) {
          throw new ConflictException(
            'Email này đã được sử dụng bởi tài khoản khác!',
          );
        }
        user.email = updateProfileDto.email;
      } else if (!updateProfileDto.email) {
        user.email = null;
      }
    }

    if (updateProfileDto.gender !== undefined) {
      user.gender = updateProfileDto.gender;
    }

    if (updateProfileDto.dateOfBirth !== undefined) {
      user.dateOfBirth = updateProfileDto.dateOfBirth || null;
    }

    const updatedUser = await this.usersRepository.save(user);
    return this.sanitizeUser(updatedUser);
  }

  // Cập nhật FCM token để nhận thông báo đẩy
  async updateFcmToken(
    userId: string,
    fcmToken: string | null,
  ): Promise<{ message: string }> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng!');
    }

    await this.usersRepository.update({ userId }, { fcmToken });
    return { message: 'Cập nhật FCM Token thành công!' };
  }

  // Quản trị viên cập nhật thông tin/trạng thái tài khoản người dùng
  async adminUpdateUser(
    userId: string,
    adminUpdateUserDto: AdminUpdateUserDto,
  ): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng!');
    }

    let shouldInvalidateTokens = false;

    // Nếu thay đổi số điện thoại
    if (
      adminUpdateUserDto.phoneNumber &&
      adminUpdateUserDto.phoneNumber !== user.phoneNumber
    ) {
      const existing = await this.findByPhoneNumber(
        adminUpdateUserDto.phoneNumber,
      );
      if (existing && existing.userId !== userId) {
        throw new ConflictException(
          'Số điện thoại này đã được sử dụng bởi tài khoản khác!',
        );
      }
      user.phoneNumber = adminUpdateUserDto.phoneNumber;
    }

    if (adminUpdateUserDto.fullName !== undefined) {
      user.fullName = adminUpdateUserDto.fullName;
    }

    // Nếu thay đổi email
    if (adminUpdateUserDto.email !== undefined) {
      if (adminUpdateUserDto.email && adminUpdateUserDto.email !== user.email) {
        const existingEmail = await this.findByEmail(adminUpdateUserDto.email);
        if (existingEmail && existingEmail.userId !== userId) {
          throw new ConflictException(
            'Email này đã được sử dụng bởi tài khoản khác!',
          );
        }
        user.email = adminUpdateUserDto.email;
      } else if (!adminUpdateUserDto.email) {
        user.email = null;
      }
    }

    if (adminUpdateUserDto.gender !== undefined) {
      user.gender = adminUpdateUserDto.gender;
    }

    if (adminUpdateUserDto.dateOfBirth !== undefined) {
      user.dateOfBirth = adminUpdateUserDto.dateOfBirth || null;
    }

    if (adminUpdateUserDto.mustChangePassword !== undefined) {
      user.mustChangePassword = adminUpdateUserDto.mustChangePassword;
    }

    if (
      adminUpdateUserDto.role !== undefined &&
      adminUpdateUserDto.role !== user.role
    ) {
      user.role = adminUpdateUserDto.role;
      shouldInvalidateTokens = true;
    }

    if (
      adminUpdateUserDto.isActive !== undefined &&
      adminUpdateUserDto.isActive !== user.isActive
    ) {
      user.isActive = adminUpdateUserDto.isActive;
      if (!adminUpdateUserDto.isActive) {
        shouldInvalidateTokens = true;
      }
    }

    if (shouldInvalidateTokens) {
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    }

    const savedUser = await this.usersRepository.save(user);
    return this.sanitizeUser(savedUser);
  }

  // Quản trị viên xóa người dùng
  async deleteUser(userId: string): Promise<{ message: string }> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng!');
    }

    await this.usersRepository.remove(user);
    return { message: 'Xóa người dùng thành công!' };
  }
}
